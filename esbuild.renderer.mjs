import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
    entryPoints: ["src/renderer/index.ts"],
    bundle: true,
    format: "iife",
    target: "es2021",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "dist/renderer/index.js",
    minify: prod,
    platform: "browser",
    external: [],
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
