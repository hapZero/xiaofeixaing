import { chromium } from "/Users/zhouzuo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";

const out = "/Users/zhouzuo/Documents/xiaofeixaing/outputs/showcase-captures";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "使用当前账号进入" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-home.png`, fullPage: true });

await page.getByRole("button", { name: /短剧 Agent/ }).first().click();
await page.waitForTimeout(700);
const project = page.getByText("拳路", { exact: true }).first();
await project.click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/02-script.png`, fullPage: true });

const assetTab = page.getByRole("button", { name: /返回资产库/ }).first();
if (await assetTab.count()) {
  await assetTab.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/03-assets.png`, fullPage: true });
  const role = page.getByText("阿强", { exact: true }).first();
  if (await role.count()) {
    await role.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/04-character.png`, fullPage: true });
    await page.keyboard.press("Escape");
  }
  const canvasEdit = page.getByRole("button", { name: /画布编辑/ }).first();
  if (await canvasEdit.count()) {
    await canvasEdit.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/04-canvas.png`, fullPage: true });
  }
}

const settings = page.getByText("设置", { exact: true }).first();
if (await settings.count()) {
  await settings.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/06-settings.png`, fullPage: true });
  await page.keyboard.press("Escape");
}

await page.getByRole("button", { name: /短剧 Agent/ }).first().click();
await page.waitForTimeout(600);
const canvasTab = page.getByRole("button", { name: "自由画布" }).first();
if (await canvasTab.count()) {
  await canvasTab.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/05-canvas-entry.png`, fullPage: true });
}

console.log(await page.locator("body").innerText());
await browser.close();
