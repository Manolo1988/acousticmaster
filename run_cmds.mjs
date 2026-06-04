import { execSync } from "child_process";

try {
  console.log("=== pwd ===");
  console.log(execSync("pwd", { encoding: "utf8" }));
  console.log("=== whoami ===");
  console.log(execSync("whoami", { encoding: "utf8" }));
  console.log("=== ls ===");
  console.log(execSync("ls -la", { encoding: "utf8" }));
  console.log("=== docker ps ===");
  console.log(execSync("docker ps 2>&1", { encoding: "utf8" }));
} catch(e) {
  console.error("Error:", e.message);
}
