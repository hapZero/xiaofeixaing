import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev:media"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev:batch"], { stdio: "inherit" }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(signal));
for (const child of children) {
  child.once("exit", (code, signal) => {
    if (!stopping) {
      stop("SIGTERM");
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
}
