import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(siteDir);
const srcDir = path.join(siteDir, "src");
const distDir = path.join(siteDir, "dist");
const brandDir = path.join(rootDir, "assets", "brand");
const locales = ["en", "ko", "ja"];
const pages = ["index", "manifesto", "install", "faq", "c"];
const baseUrl = "https://nautli.ai";

const assetHash = async (file) =>
  createHash("sha256").update(await readFile(path.join(srcDir, file))).digest("hex").slice(0, 8);
const assetVersions = {
  style: await assetHash("style.css"),
  script: await assetHash("main.js"),
};

const { renderPage, pagePath } = await import(
  pathToFileURL(path.join(srcDir, "template.mjs")).href
);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

// dist/ is committed, and the wipe above removes this tracked file every build.
// Recreate it so a build never silently drops the deploy ignores.
await writeFile(path.join(distDir, ".gitignore"), ".vercel\n.env*\n", "utf8");

const messages = {};
for (const locale of locales) {
  messages[locale] = JSON.parse(
    await readFile(path.join(srcDir, "i18n", `${locale}.json`), "utf8"),
  );
}

for (const locale of locales) {
  for (const page of pages) {
    const relative = pagePath(locale, page).replace(/^\//, "");
    const output = relative === "" || relative.endsWith("/")
      ? path.join(distDir, relative, "index.html")
      : path.join(distDir, relative);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(
      output,
      renderPage({ locale, page, copy: messages[locale], baseUrl, assetVersions }),
      "utf8",
    );
  }
}

await copyFile(path.join(srcDir, "style.css"), path.join(distDir, "style.css"));
await copyFile(path.join(srcDir, "main.js"), path.join(distDir, "main.js"));

const fontsOut = path.join(distDir, "fonts");
await mkdir(fontsOut, { recursive: true });
for (const name of await readdir(path.join(srcDir, "fonts"))) {
  if (!name.endsWith(".woff2")) continue;
  await copyFile(path.join(srcDir, "fonts", name), path.join(fontsOut, name));
}

const assetsOut = path.join(distDir, "assets");
await mkdir(assetsOut, { recursive: true });
// 페이지가 참조하는 자산은 없으면 빌드를 세운다.
// ENOENT를 삼키면 og:image가 404인 채로 몇 주가 지나간다(2026-07-19에 실제로 발견).
for (const [source, destination] of [
  ["nautli-favicon.svg", "favicon.svg"],
  ["nautli-favicon.ico", "favicon.ico"],
]) {
  await copyFile(path.join(brandDir, source), path.join(assetsOut, destination));
}

const brandFiles = await readdir(brandDir);
const ogSource = brandFiles
  .filter((name) => /^nautli-og-1200x630.*\.png$/i.test(name))
  .sort()[0];
if (!ogSource) {
  throw new Error(
    `og:image가 /assets/og.png를 참조하는데 ${brandDir}에 nautli-og-1200x630*.png가 없다`,
  );
}
await copyFile(path.join(brandDir, ogSource), path.join(assetsOut, "og.png"));

const sitemapEntries = [];
for (const page of pages) {
  for (const locale of locales) {
    const alternates = [
      ...locales.map((alternateLocale) => ({
        lang: alternateLocale,
        href: `${baseUrl}${pagePath(alternateLocale, page)}`,
      })),
      { lang: "x-default", href: `${baseUrl}${pagePath("en", page)}` },
    ];
    sitemapEntries.push(`  <url>
    <loc>${baseUrl}${pagePath(locale, page)}</loc>
${alternates.map(({ lang, href }) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />`).join("\n")}
  </url>`);
  }
}

await writeFile(
  path.join(distDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapEntries.join("\n")}
</urlset>
`,
  "utf8",
);

await writeFile(
  path.join(distDir, "robots.txt"),
  `User-agent: *
Allow: /
Sitemap: ${baseUrl}/sitemap.xml
`,
  "utf8",
);
