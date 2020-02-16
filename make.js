#!/usr/bin/env node
// Usage: ./make.js command. Use -h for help.
// This is a set of tasks for building and testing Vimium in development.

fs = require("fs");
child_process = require("child_process");

// Spawns a new process and returns it.
function spawn(procName, optArray, silent = false, sync = false) {
  if (process.platform == "win32") {
    // if win32, prefix arguments with "/c {original command}"
    // e.g. "coffee -c c:\git\vimium" becomes "cmd.exe /c coffee -c c:\git\vimium"
    optArray.unshift("/c", procName)
    procName = "cmd.exe"
  }
  proc = null
  if (sync) {
    proc = child_process.spawnSync(procName, optArray, {
      stdio: [undefined, process.stdout, process.stderr]
    });
  } else {
    proc = child_process.spawn(procName, optArray)
    if (!silent) {
      proc.stdout.on('data', (data) => process.stdout.write(data));
      proc.stderr.on('data', (data) => process.stderr.write(data));
    }
  }
  return proc;
}

// Compile coffeescript into javascript.
function build() {
  coffee = spawn("coffee", ["-c", __dirname], false, true)
  if (coffee.status != 0) {
    console.log("Build failed. Coffee exited with status", coffee.status);
    process.exit(coffee.status);
  }
}

// Builds a zip file for submission to the Chrome store. The output is in dist/.
function buildStorePackage() {
  const vimiumVersion = JSON.parse(fs.readFileSync("manifest.json").toString())["version"]
  build();

  spawn("rm", ["-rf", "dist/vimium"], false, true);
  spawn("mkdir", ["-p", "dist/vimium"], false, true);

  const blacklist = [".*", "*.coffee", "*.md", "reference", "test_harnesses", "tests", "dist", "git_hooks",
                     "CREDITS", "node_modules", "MIT-LICENSE.txt", "Cakefile"];
  const rsyncOptions = [].concat.apply(
    ["-r", ".", "dist/vimium"],
    blacklist.map((item) => ["--exclude", item]));

  spawn("rsync", rsyncOptions, false, true);

  const distManifest = "dist/vimium/manifest.json";
  const manifest = JSON.parse(fs.readFileSync(distManifest).toString());

  // Build the Chrome Store package; this does not require the clipboardWrite permission.
  manifest.permissions = manifest.permissions.filter((p) => p != "clipboardWrite");
  fs.writeFileSync(distManifest, JSON.stringify(manifest, null, 2));
  spawn("zip", ["-r", `dist/vimium-chrome-store-${vimiumVersion}.zip`, "dist/vimium"], false, true);

  // Build the Chrome Store dev package.
  manifest.name = "Vimium Canary";
  manifest.description = "This is the development branch of Vimium (it is beta software).";
  fs.writeFileSync(distManifest, JSON.stringify(manifest, null, 2));
  spawn("zip", ["-r", `dist/vimium-canary-${vimiumVersion}.zip`, "dist/vimium"], false, true);

  // Build Firefox release.
  const args = "-r -FS dist/vimium-ff-${vimium_version}.zip background_scripts Cakefile " +
        "content_scripts CONTRIBUTING.md CREDITS icons lib manifest.json MIT-LICENSE.txt pages README.md" +
        "-x *.coffee -x Cakefile -x CREDITS -x *.md";
  spawn("zip", args.split(/\s+/), false, true);
}

// Returns how many tests failed.
function runUnitTests() {
  console.log("Running unit tests...")
  projectDir = "."
  basedir = projectDir + "/tests/unit_tests/";
  test_files = fs.readdirSync(basedir).filter((filename) => filename.indexOf("_test.js") > 0)
  test_files = test_files.map((filename) => basedir + filename)
  test_files.forEach((file) => {
    path = (file[0] == '/' ? '' : './') + file;
    require(path);
  });
  return Tests.run();
}

// Returns how many tests fail.
function runDomTests() {
  const puppeteer = require("puppeteer");

  const testFile = __dirname + "/tests/dom_tests/dom_tests.html";

  (async () => {
    const browser = await puppeteer.launch({
      // NOTE(philc): "Disabling web security" is required for vomnibar_test.js, because we have a file://
      // page accessing an iframe, and Chrome prevents this because it's a cross-origin request.
      args: ['--disable-web-security']
    });
    const page = await browser.newPage();
    page.on("console", msg => console.log(msg.text()));
    await page.goto("file://" + testFile);
    const testsFailed = await page.evaluate(() => {
      Tests.run();
      return Tests.testsFailed;
    });
    await browser.close();
    return testsFailed;
  })();
}

// Prints the list of valid commands.
function printHelpString() {
  console.log("Usage: ./make.js command\n\nValid commands:");
  const keys = Object.keys(commands).sort();
  for (let k of keys)
    console.log(k, ":", commands[k].help);
}

const commands = []
// Defines a new command.
function command(name, helpString, fn) {
  commands[name] = { help: helpString, fn: fn };
}

command(
  "build",
  "compile all coffeescript files to javascript",
  build);

command(
  "test",
  "Run all tests",
  () => {
    build();
    let failed = runUnitTests();
    failed += runDomTests();
    if (failed > 0)
      Process.exit(1);
  });

command(
  "test-unit",
  "Run unit tests",
  () => {
    build();
    const failed = runUnitTests() > 0;
    if (failed > 0)
      Process.exit(1);
  });

command(
  "test-dom",
  "Run DOM tests",
  () => {
    build();
    const failed = runDomTests();
    if (failed > 0)
      Process.exit(1);
  });

command(
  "autobuild",
  "continually rebuild coffeescript files using coffee --watch",
  () => {
    spawn("coffee", ["-cw", __dirname]);
  });

command(
  "package",
  "Builds a zip file for submission to the Chrome store. The output is in dist/",
  buildStorePackage);

if (process.argv.includes("-h") || process.argv.includes("--help") || process.argv.length == 2) {
  printHelpString();
  return;
}

commandArg = process.argv[2]

if (commands[commandArg]) {
  commands[commandArg].fn();
} else {
  printHelpString();
  process.exit(1);
}
