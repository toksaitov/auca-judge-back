#!/usr/bin/env bash

USERNAME="toksaitov"
REPOSITORY="images"
TAG="auca-judge-c-build"

# Create a Build Image.

docker build --tag="$USERNAME/$REPOSITORY:$TAG" .
