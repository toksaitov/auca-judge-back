auca-judge-back
===============

*auca-judge-back* is a build and test orchestration service for the *auca-judge*
system.

*auca-judge-back* controls the container runtime to start build and test
containers, issue build and test requests to instances of
[auca-judge-agent](https://github.com/toksaitov/auca-judge-agent)
inside, get results back and save them in a state database.

## Prerequisites

* *Node.js*, *npm* `>=4.4.3`, `>=2.15.2`
* *Docker* `>= 1.10`
* *Redis* `>= 3.0.7`
* *MongoDB*, *MongoDB Tools* `>= 3.2.5`

## Communication

*auca-judge-back* responds to the following HTTP request

**POST** */submit*

```http
Content-Type: application/x-www-form-urlencoded

id=<problem ID>&submission=<urlencoded sources>
```

For the */submit* request *auca-judge-back* creates a new submission entry in
the status database, loads a problem for the provided ID from the problem
database, starts a build container if nessesary, sends data to the build agent
inside the container, waits for a compiled artifact, sequentally starts
containers for each test case, sends compiled or raw artifacts with input data
to test agents, waits for results, compares them with correct data, finally,
saves test reports, errors, general task information to a status database.

*auca-judge-back* will instantly send a reply upon successful task submission.
A client should query a status database to get progress information on its own.

* *302*: success, the client can check the progress at the destination specified
  in the `location` header. The destination URL will contain a path in the form
  `/submissions/<new submission ID>`.

* *400*: invalid submission parameters (`id` or `submission`), details can be
  found in the body of the reply

* *500*: the test system has failed, details can be found in the body of the
  reply

## Usage 

* `npm install --global gulp-cli`: to install the command-line interface for the
  `gulp` build system

* `gulp images`: to use `docker` to create images of build and test containers
  from the `images` directory

  Note, that you need to build the `toksaitov/images:auca-judge-agent`
  [image](https://github.com/toksaitov/auca-judge-agent) first.

      git clone https://github.com/toksaitov/auca-judge-agent.git && cd auca-judge-agent
      docker build --tag="toksaitov/images:auca-judge-agent" .

* `gulp problems`: to use `mongo` to recreate the `auca-judge` database and
  `mongoimport` to import sample data from the `problems` directory

* `npm install`: to install dependencies

* `npm start`: to start the server

## Licensing

*auca-judge-back* is licensed under the MIT license. See LICENSE for the full
license text.

## Credits

*auca-judge-back* was created by [Dmitrii Toksaitov](https://github.com/toksaitov).
