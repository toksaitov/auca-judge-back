"use strict";

const path =
  require("path");
const fs =
  require("fs");
const vm =
  require("vm");
const util =
  require("util");

const express =
  require("express");
const bodyParser =
  require("body-parser");
const redis =
  require("redis");
const mongoose =
  require("mongoose");
const Dockerode =
  require("dockerode");
const httpRequest =
  require("request");
const winston =
  require("winston");
const uuid =
  require("node-uuid");

const helpers =
  require("./lib/helpers.js");

const Server =
  express();
const ServerPort =
  7070;

const RedisConnectionOptions =
  null;
const Redis =
  redis.createClient(
    RedisConnectionOptions
  );

const MongoConnectionOptions = {
  "url": "mongodb://0.0.0.0:27017/auca_judge",
  "options": null
};
const Mongo =
  mongoose.createConnection(
    MongoConnectionOptions.url,
    MongoConnectionOptions.options
  );
mongoose.model(
  "Problem", require("./lib/models/problem.js")
);

const DockerConnectionOptions =
  null;
const Docker =
  new Dockerode(
    DockerConnectionOptions
  );

const BuildAgentConnectionOptions = {
  "port": "7742"
};
const TestAgentConnectionOptions = {
  "port": "7743"
};

const Logger =
  new winston.Logger({
    transports: [new winston.transports.Console()]
  });

const Problems =
  { };
const Submissions =
  { };

const ProblemDirectory =
  "problems";
const LoadProblemFromFile =
  false;

function loadProblemFromFile(problemID, onResultCallback) {
  let problemFile =
    path.join(ProblemDirectory, `${problemID}.json`);

  let problem = null;
  try {
    problem =
      JSON.parse(fs.readFileSync(problemFile, "utf8"));
  } catch (error) {
    onResultCallback(error, problem);

    return;
  }

  onResultCallback(null, problem);
}

function loadProblem(problemID, onResultCallback) {
  let Problem =
    Mongo.model("Problem");

  Problem.findById(problemID, (error, problem) => {
    onResultCallback(error, problem);
  });
}

function updateSubmissionInformation(submissionID) {
  let submission =
    Submissions[submissionID];

  if (submission) {
    submission =
      Object.assign({}, submission);

    let results =
      submission["results"];

    if (results) {
      submission["results"] =
        results.toString();
    }

    Redis.hmset(submissionID, submission, (error, reply) => {
      if (error) {
        Logger.error(
          "Failed to update submission information " +
          `for ${submissionID}.`
        );
        Logger.error(reply);
        Logger.error(error);
      }
    });
  }
}

function getSubmissionInformation(submissionID, onResultCallback) {
  let submission =
    Submissions[submissionID];

  if (submission) {
    onResultCallback(null, submission);

    return;
  }

  Redis.hgetall(submissionID, (error, submission) => {
    if (!error) {
      if (submission) {
        let results =
          submission["results"];

        if (results) {
          submission["results"] =
            results.split(",");
        }
      }
    }

    onResultCallback(error, submission);
  });
}

Redis.on("error", error => {
  Logger.error("The redis client has encountered an error");
  Logger.error(error);
});

Mongo.on("error", error => {
  Logger.error("The mongo client has encountered an error");
  Logger.error(error);
});

Server.use(bodyParser.urlencoded({
  "extended": true
}));

Server.post("/submit", (request, response) => {
  let submissionID =
    uuid.v4();
  let environment = [
    `SUBMISSION_ID=${submissionID}`
  ];

  let containers =
    [];

  let cleanup = () => {
    helpers.removeContainers(containers);
  };

  let processError = parameters => {
    let code =
      parameters["code"];
    let message =
      parameters["message"];
    let responseMessage =
      parameters["response"] || message;
    let error =
      parameters["error"];
    let status =
      parameters["status"] || "failed";

    const standardStreamsCharacterLimit =
      1000;

    let submissionExitStatus =
      parameters["submissionExitStatus"] || 0;
    let submissionStandardOutput =
      (parameters["submissionStandardOutput"] || "").substring(
        0, standardStreamsCharacterLimit
      );
    let submissionStandardError =
      (parameters["submissionStandardError"] || "").substring(
        0, standardStreamsCharacterLimit
      );

    Submissions[submissionID]["status"] = status;
    Submissions[submissionStandardOutput] = submissionStandardOutput;
    Submissions[submissionStandardError]  = submissionStandardError;
    updateSubmissionInformation(submissionID);

    if (message) {
      Logger.error(`${message}\n`);
    }
    if (error)   {
      Logger.error(`exception:\n${error}\n`);
    }
    if (request) {
      Logger.error(`request:\n${util.inspect(request, { "depth": 2 })}\n`);
    }

    if (submissionExitStatus) {
      Logger.error(`submission's exit status:\n${submissionExitStatus}\n`);
    }
    if (submissionStandardOutput) {
      Logger.error(
        `submission's standard output:\n${submissionStandardOutput}\n`
      );
    }
    if (submissionStandardError) {
      Logger.error(
        `submission's standard error:\n${submissionStandardError}\n`
      );
    }

    if (code && response && responseMessage) {
      response.status(code).json({
        "error": responseMessage
      });
    }

    cleanup();
  }

  let redirectToSubmissionResults = () => {
    let location =
      `/submissions/${submissionID}`;

    response.redirect(location);
  }

  Submissions[submissionID] = {
    "id": submissionID,
    "status": "in progress"
  };
  updateSubmissionInformation(submissionID);

  let problemID =
    request.body["id"];

  if (!problemID) {
    processError({
      "code": 400,
      "message": `The problem ID was not provided.`
    });

    return;
  }

  let submission =
    request.body["submission"];

  if (!submission) {
    processError({
      "code": 400,
      "response": "Submission sources were not provided.",
      "message": `Submission sources for a problem ID '${problemID}' ` +
                 "were not provided."
    });

    return;
  }

  let problem =
    Problems[problemID];

  if (problem) {
    processProblem(problem);
  } else {
    let loader =
      LoadProblemFromFile ? loadProblemFromFile : loadProblem;

    loader(problemID, (error, problem) => {
      if (error) {
        processError({
          "code": 500,
          "response": "No problem definitions were found for the provided ID.",
          "error": error,
          "message": "Failed to load a problem definition for " +
                     `the ID '${problemID}'.`
        });

        return;
      }

      Problems[problemID] =
        problem;

      processProblem(problem);
    });
  }

  function processProblem(problem) {
    if (!problem) {
      processError({
        "code": 500,
        "response": "The test system has failed.",
        "message": `The problem '${problemID}' has no information.`
      });

      return;
    }

    let buildImage =
      problem["build"]["image"];
    let buildExtension =
      problem["build"]["extension"] || "";
    let buildArtifactExtension =
      problem["build"]["artifactExtension"] || "";
    let testImage =
      problem["test"]["image"];
    let testExtension =
      problem["test"]["extension"] || "";
    let continueOnTestFailure =
      problem["test"]["continueOnFailure"];
    let globalTestEvaluator =
      problem["test"]["evaluator"];
    let tests =
      problem["test"]["tests"];

    if (!testImage) {
      processError({
        "code": 500,
        "response": "The test system has failed.",
        "message": `A test image for the problem ID '${problemID}' ` +
                   "was not defined."
      });

      return;
    }

    if (!tests) {
      processError({
        "code": 500,
        "response": "The test system has failed.",
        "message": `Tests for the problem ID '${problemID}' were not defined.`
      });

      return;
    }

    function startTesting(submissionArtifact, tests) {
      Submissions[submissionID]["status"]  = "testing";
      Submissions[submissionID]["results"] = [];
      updateSubmissionInformation(submissionID);

      runNextTest(submissionArtifact, tests);
    }

    function finishTesting() {
      Submissions[submissionID]["status"] = "finished";
      updateSubmissionInformation(submissionID);

      cleanup();
    }

    function runNextTest(submissionArtifact, tests) {
      let test =
        tests.shift();

      if (!test) {
        finishTesting();

        return;
      }

      let testResults = Submissions[submissionID]["results"];
      testResults.push("testing")
      updateSubmissionInformation(submissionID);

      let testNumber =
        testResults.length;

      let testInput =
        test["input"];
      let encodedTestInput =
        new Buffer(testInput).toString("base64");
      let correctOutput =
        test["output"];
      let shouldPreprocessOutput =
        test["preprocess"];
      let evaluator =
        test["evaluator"] || globalTestEvaluator;
      let evaluatorTimeout =
        test["evaluatorTimeout"] || 5000;

      let command =
        [];
      let streams =
        [process.stdout, process.stderr];
      let options = {
        "Env": environment,
        "HostConfig": {
          "PublishAllPorts": true
        },
        "Tty": false
      };

      Docker.run(testImage, command, streams, options, error => {
        if (error) {
          processError({
            "error": error,
            "message": `Failed to run the test container '${testImage}' ` +
                       `while working on a problem with the ID '${problemID}'.`
          });
        }
      }).
      on("container", container => {
        if (container) {
          containers.push(container);
        }
      }).
      on("start", container => {
        container.inspect((error, data) => {
          if (error) {
            processError({
              "error": error,
              "message": `Failed to inspect the test container '${testImage}' ` +
                         `while working on a problem with the ID '${problemID}'.`
            });

            return;
          }

          let testAgentHost =
            BuildAgentConnectionOptions["host"];
          let testAgentPort =
            TestAgentConnectionOptions["port"];

          let containerBindings =
            "";
          let containerHost =
            "";
          let containerPort =
            "";

          try {
            containerBindings =
              data["NetworkSettings"]["Ports"][`${testAgentPort}/tcp`][0];
            containerHost =
              testAgentHost || containerBindings["HostIp"];
            containerPort =
              containerBindings["HostPort"];
          } catch (error) {
            processError({
              "error": error,
              "message": "Failed to extract host and port information of the " +
                         `test container '${testImage}' while working on a `   +
                         `problem with the ID '${problemID}'.`
            });

            return;
          }

          let containerURL =
            `http://${containerHost}:${containerPort}/process`;

          setTimeout(() => {
            let attempts = 3;
            accessTestAgent(containerURL, attempts);
          }, 250);
        });

        function accessTestAgent(testAgentURL, attempts) {
          let testInputFile =
            `${submissionID}.input`;
          let testOutputFile =
            `${submissionID}.output`;

          let testAgentRequestOptions = {
            "url": testAgentURL,
            "json": true,
            "body": {
              "files": {
                [submissionArtifact.name]: submissionArtifact.data,
                [testInputFile]: encodedTestInput
              }
            }
          };

          httpRequest.post(testAgentRequestOptions, (error, response, body) => {
            if (error || !response || response.statusCode !== 200) {
              let responseStatus =
                response ? response.statusCode : "-";

              processError({
                "error": error,
                "message": "Failed to communicate with the test container " +
                           `'${testImage}'. The response status and reply ` +
                           `body were '${responseStatus}'\n${body}`
              });

              if (attempts > 0) {
                setTimeout(() => {
                  accessTestAgent(testAgentURL, attempts - 1);
                }, 500);
              }

              return;
            }

            let submissionExitStatus =
              body["status"];
            let submissionStandardOutput =
              body["stdout"];
            let submissionStandardError =
              body["stderr"];
            let submissionOutput =
              body["artifacts"];

            if (submissionExitStatus !== 0) {
              processError({
                "error": error,
                "submissionExitStatus":     submissionExitStatus,
                "submissionStandardOutput": submissionStandardOutput,
                "submissionStandardError":  submissionStandardError,
                "message": "Failed to run a submission inside the " +
                           `container '${testImage}'.`
              });
            } else if (!submissionOutput.hasOwnProperty(testOutputFile)) {
              processError({
                "error": error,
                "submissionExitStatus":     submissionExitStatus,
                "submissionStandardOutput": submissionStandardOutput,
                "submissionStandardError":  submissionStandardError,
                "message": `Test results from the container '${testImage}' do ` +
                           "not contain the submission's output for "           +
                           `'${testOutputFile}'.`
              });
            } else if (submissionOutput[testOutputFile] === null) {
              processError({
                "error": error,
                "submissionExitStatus":     submissionExitStatus,
                "submissionStandardOutput": submissionStandardOutput,
                "submissionStandardError":  submissionStandardError,
                "message": `The submission from the container '${testImage}' ` +
                           "did not produce any data for "                     +
                           `'${testOutputFile}'.`
              });
            } else {
              let encodedTestOutput =
                submissionOutput[testOutputFile] || "";
              let testOutput =
                new Buffer(encodedTestOutput, "base64").toString("utf8");

              checkTestOutput(testOutput);
            }
          });
        }

        function checkTestOutput(testOutput) {
          let processedTestOutput =
            testOutput;
          let testWasPassed =
            !correctOutput && !evaluator;

          if (!testWasPassed) {
            if (shouldPreprocessOutput) {
              processedTestOutput =
                testOutput.trim();
            }

            if (evaluator) {
              let script =
                "evaluatorResult = (function(input, output, result) {" +
                  evaluator +
                "})(testInput, correctOutput, testOutput);";
              let scriptOptions = {
                "timeout": evaluatorTimeout
              }

              let evaluatorSandbox = {
                "testInput": testInput,
                "correctOutput": correctOutput,
                "testOutput": processedTestOutput
              };
              let evaluatorContext =
                vm.createContext(
                  evaluatorSandbox
                );

              let evaluatorScript = null;
              try {
                evaluatorScript =
                  new vm.Script(script, scriptOptions);
              } catch (error) {
                processError({
                  "error": error,
                  "message": "Failed to create an evaluator script while "      +
                             `working on a problem with the ID '${problemID}' ` +
                             `and processing test '${testNumber}'.`
                });

                return;
              }

              try {
                evaluatorScript.runInContext(evaluatorContext);
              } catch (error) {
                processError({
                  "error": error,
                  "message": "Failed to run an evaluator script while "         +
                             `working on a problem with the ID '${problemID}' ` +
                             `and processing test '${testNumber}'.`
                });

                return;
              }

              testWasPassed =
                !!evaluatorSandbox["evaluatorResult"];
            } else {
              testWasPassed =
                processedTestOutput === correctOutput;
            }
          }

          let testStatus =
            testWasPassed ? "passed" : "failed";
          let testStatistics =
            `Submission '${submissionID}'\n`      +
            `Test ${testNumber}: ${testStatus}\n` +
            `Input:\n"\n${testInput}\n"\n---\n`   +
            `Ouput:\n"\n${processedTestOutput}\n"\n---\n`;

          testResults[testResults.length - 1] = testStatus;
          updateSubmissionInformation(submissionID);

          helpers.removeContainer(container, () => {
            if (testWasPassed) {
              Logger.info(testStatistics);

              runNextTest(submissionArtifact, tests);
            } else {
              testStatistics +=
                `Should be:\n"\n${correctOutput}\n"\n---\n`;

              Logger.error(testStatistics);

              if (continueOnTestFailure) {
                runNextTest(submissionArtifact, tests);
              } else {
                finishTesting();
              }
            }
          });
        }
      });
    }

    redirectToSubmissionResults();

    if (buildImage) {
      let command =
        [];
      let streams =
        [process.stdout, process.stderr];
      let options = {
        "Env": environment,
        "HostConfig": {
          "PublishAllPorts": true
        },
        "Tty": false
      };

      Docker.run(buildImage, command, streams, options, error => {
        if (error) {
          processError({
            "error": error,
            "message": `Failed to run the build container '${buildImage}' ` +
                       `while working on a problem with the ID '${problemID}'.`
          });
        }
      }).
      on("container", container => {
        if (container) {
          containers.push(container);
        }
      }).
      on("start", container => {
        Submissions[submissionID]["status"] = "building";
        updateSubmissionInformation(submissionID);

        container.inspect((error, data) => {
          if (error) {
            processError({
              "error": error,
              "message": `Failed to inspect the build container '${buildImage}' ` +
                         `while working on a problem with the ID '${problemID}'.`
            });

            return;
          }

          let buildAgentHost =
            BuildAgentConnectionOptions["host"];
          let buildAgentPort =
            BuildAgentConnectionOptions["port"];

          let containerBindings =
            "";
          let containerHost =
            "";
          let containerPort =
            "";

          try {
            containerBindings =
              data["NetworkSettings"]["Ports"][`${buildAgentPort}/tcp`][0];
            containerHost =
              buildAgentHost || containerBindings["HostIp"];
            containerPort =
              containerBindings["HostPort"];
          } catch (error) {
            processError({
              "error": error,
              "message": "Failed to extract host and port information of the " +
                         `build container '${buildImage}' while working on a ` +
                         `problem with the ID '${problemID}'.`
            });

            return;
          }

          let containerURL =
            `http://${containerHost}:${containerPort}/process`;

          setTimeout(() => {
            let attempts = 3;
            accessBuildAgent(containerURL, attempts);
          }, 250);
        });

        function accessBuildAgent(buildAgentURL, attempts) {
          let submissionFile =
            `${submissionID}${buildExtension}`;
          let submissionData =
            new Buffer(submission).toString("base64");
          let submissionArtifactExtension =
            testExtension || buildArtifactExtension;
          let submissionArtifactFile =
            `${submissionID}${submissionArtifactExtension}`;

          let buildAgentRequestOptions = {
            "url": buildAgentURL,
            "json": true,
            "body": {
              "files": {
                [submissionFile]: submissionData
              }
            }
          };

          httpRequest.post(buildAgentRequestOptions, (error, response, body) => {
            if (error || !response || response.statusCode !== 200) {
              let responseStatus =
                response ? response.statusCode : "-";

              processError({
                "error": error,
                "message": "Failed to communicate with the build container " +
                           `'${buildImage}'. The response status and reply ` +
                           `body were '${responseStatus}'\n${body}`
              });

              if (attempts > 0) {
                setTimeout(() => {
                  accessBuildAgent(buildAgentURL, attempts - 1);
                }, 500);
              }

	      return;
            }

            let submissionExitStatus =
              body["status"];
            let submissionStandardOutput =
              body["stdout"];
            let submissionStandardError =
              body["stderr"];
            let submissionOutput =
              body["artifacts"];

            if (submissionExitStatus !== 0) {
              processError({
                "error": error,
                "submissionExitStatus":     submissionExitStatus,
                "submissionStandardOutput": submissionStandardOutput,
                "submissionStandardError":  submissionStandardError,
                "message": "Failed to build a submission inside the " +
                           `container '${buildImage}'.`
              });
            } else if (!submissionOutput.hasOwnProperty(submissionArtifactFile)) {
              processError({
                "error": error,
                "submissionExitStatus":     submissionExitStatus,
                "submissionStandardOutput": submissionStandardOutput,
                "submissionStandardError":  submissionStandardError,
                "message": `Build results from the container '${buildImage}' do ` +
                           "not contain the build output for "                    +
                           `'${submissionArtifactFile}'.`
              });
            } else if (submissionOutput[submissionArtifactFile] === null) {
              processError({
                "error": error,
                "submissionExitStatus":     submissionExitStatus,
                "submissionStandardOutput": submissionStandardOutput,
                "submissionStandardError":  submissionStandardError,
                "message": `The build from the container '${buildImage}' ` +
                           "did not produce any data for "                 +
                           `'${submissionArtifactFile}'.`
              });
            } else {
              let submissionArtifactData =
                submissionOutput[submissionArtifactFile] || "";

              let submissionArtifact = {
                "name": submissionArtifactFile,
                "data": submissionArtifactData
              };
              let clonedTests =
                tests.slice();

              startTesting(submissionArtifact, clonedTests);
            }
          });
        }
      });
    } else {
      let submissionArtifactExtension =
        testExtension || buildExtension;
      let submissionArtifactFile =
        `${submissionID}${submissionArtifactExtension}`;
      let submissionArtifactData =
        new Buffer(submission).toString("base64");

      let submissionArtifact = {
        "name": submissionArtifactFile,
        "data": submissionArtifactData
      };
      let clonedTests =
        tests.slice();

      startTesting(submissionArtifact, clonedTests);
    }
  }
});

Server.get("/submissions/:id", (request, response) => {
  let submissionID =
    request.params["id"];

  let processError = parameters => {
    let code =
      parameters["code"];
    let message =
      parameters["message"];
    let responseMessage =
      parameters["response"] || message;
    let error =
      parameters["error"];

    if (message) {
      Logger.error(`${message}\n`);
    }
    if (error)   {
      Logger.error(`exception:\n${error}\n`);
    }
    if (request) {
      Logger.error(`request:\n${util.inspect(request, { "depth": 2 })}\n`);
    }

    if (code && response && responseMessage) {
      response.status(code).json({
        "error": responseMessage
      });
    }
  }

  if (!submissionID) {
    processError({
      "code": 400,
      "message": "The submission ID was not provided."
    });

    return;
  }

  getSubmissionInformation(submissionID, (error, submission) => {
    if (error) {
      processError({
        "code": 400,
        "response": "Invalid submission ID.",
        "error": error,
        "message": "Failed to find a submission with the " +
                   `ID '${submissionID}'.`
      });

      return;
    }

    response.json(submission);
  });
});

Server.listen(ServerPort, () => {
  Logger.info(`auca-judge-back is listening on port ${ServerPort}.`);
});
