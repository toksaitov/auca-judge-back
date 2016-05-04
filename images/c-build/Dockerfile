# Use the `auca-judge-agent` image as a base (a `golang:onbuild` variant).

FROM toksaitov/images:auca-judge-agent

# Install the GNU C Compiler.

RUN apt-get update && apt-get install gcc

# Create a working directory for the build agent.

RUN mkdir /submission

# Copy the build agent's configuration files and use the newly created directory
# as its working directory to load the files.

COPY agent /agent/
WORKDIR /agent

# Expose the build agent's communication port.

EXPOSE 7742

# `golang:onbuild` images compile sources into a binary under the name `app`.

# Start the build agent on `run` commands.

CMD app
