const PREFIX = "[ComickSync]";

function info(...args) {
  console.log(PREFIX, ...args);
}

function warn(...args) {
  console.warn(PREFIX, ...args);
}

function error(...args) {
  console.error(PREFIX, ...args);
}

export { info, warn, error };
