#!/usr/bin/env sh

USERNAME="toksaitov"
REPOSITORY="images"
TAG="auca-judge-c-test"

# Create a Test Image.

docker build --tag="$USERNAME/$REPOSITORY:$TAG" .
