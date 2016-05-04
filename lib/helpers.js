"use strict";

function removeContainer(container, onResultCallback) {
  let options = {
    "v": true,
    "force": true
  };

  container.remove(options, onResultCallback || () => { });
}

function removeContainers(containers) {
  containers.forEach(container => {
    removeContainer(container);
  });
}

exports.removeContainer =
  removeContainer;
exports.removeContainers =
  removeContainers;
