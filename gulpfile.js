"use strict";

const gulp =
  require("gulp");
const spawn =
  require("child_process").spawn;
const fs =
  require("fs");
const path =
  require("path");

const ImageDirectory =
  "images";
const ProblemDirectory =
  "problems";

const DatabaseName =
  "auca_judge";
const CollectionName =
  "problems";

const DockerHubUser =
  "toksaitov"
const DockerHubRepository =
  "images"

function formDirectoryListForDirectory(directory) {
  let entries =
    fs.readdirSync(directory);

  entries =
    entries.map(entry => path.join(directory, entry));
  entries =
    entries.filter(entry => fs.statSync(entry).isDirectory());

  return entries;
}

function buildDirectory(directory, onFinishCallback) {
  let tag =
    path.basename(directory);
  let docker =
    "docker";
  let args =
    [ "build", `--tag="${DockerHubUser}/${DockerHubRepository}:${tag}"`, "." ];
  let options = {
    "cwd": directory,
    "stdio": "inherit"
  };

  let command =
    spawn(docker, args, options);

  command.on("close", () => {
    onFinishCallback();
  });
}

function buildDirectories(directories, onFinishCallback) {
  let directory =
    directories.shift();

  if (directory) {
    buildDirectory(directory, () => {
      buildDirectories(directories, onFinishCallback);
    });
  } else {
    onFinishCallback();
  }
}

function formProblemListForDirectory(directory) {
  let entries =
    fs.readdirSync(directory);

  entries =
    entries.map(entry => path.join(directory, entry));
  entries =
    entries.filter(
      entry => (/^.*\.json$/).test(entry) && fs.statSync(entry).isFile()
    );

  return entries;
}

function dropCollection(collection, onFinishCallback) {
  let dbcli =
    "mongo";
  let args = [
    `${DatabaseName}`,
    `--eval=db.getCollection("${collection}").drop()`
  ];
  let options = {
    "stdio": "inherit"
  };

  let command =
    spawn(dbcli, args, options);

  command.on("close", () => {
    onFinishCallback();
  });
}

function importProblem(problem, onFinishCallback) {
  let resolvedProblem =
    path.resolve(problem);

  let dbimporter =
    "mongoimport";
  let args = [
    `--db="${DatabaseName}"`,
    '--collection="problems"',
    `--file="${resolvedProblem}"`
  ];
  let options = {
    "stdio": "inherit"
  };

  let command =
    spawn(dbimporter, args, options);

  command.on("close", () => {
    onFinishCallback();
  });
}

function importProblems(problems, onFinishCallback) {
  let problem =
    problems.shift();

  if (problem) {
    importProblem(problem, () => {
      importProblems(problems, onFinishCallback);
    });
  } else {
    onFinishCallback();
  }
}

gulp.task("images", onFinishCallback => {
  let directories =
    formDirectoryListForDirectory(ImageDirectory);

  buildDirectories(directories, onFinishCallback);
});

gulp.task("problems", onFinishCallback => {
  dropCollection(CollectionName, () => {
    let problems =
        formProblemListForDirectory(ProblemDirectory);

    importProblems(problems, onFinishCallback);
  });
});
