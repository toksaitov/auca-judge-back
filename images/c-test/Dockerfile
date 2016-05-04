# Use the `auca-judge-agent` image as a base (a `golang:onbuild` variant).

FROM toksaitov/images:auca-judge-agent

# Create a working directory for the test agent.

RUN mkdir /submission

# Copy the test runner.

COPY runner /runner

# Copy the test agent's configuration files and use the newly created directory
# as its working directory to load the files.

COPY agent /agent/
WORKDIR /agent

# Expose the test agent's communication port.

EXPOSE 7743

# `golang:onbuild` images compile sources into a binary under the name `app`.

# Start the test agent on `run` commands.

CMD app
