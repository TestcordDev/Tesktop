/*
 * Regression tests for the tab bar being actually clickable.
 *
 * Every other suite calls `element.click()`, which invokes the handler directly and
 * completely bypasses hit-testing, stacking and drag regions. That is exactly how a
 * strip which paints under Discord's fixed-position app, or inside a
 * -webkit-app-region: drag body, passed every test while doing nothing for a real
 * mouse. These tests assert on the CSS that decides hit-testing instead.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { accountTabsStyleText } from "../../src/renderer/accountTabs/tabBar.ts";

const css = accountTabsStyleText();
const shellHtml = readFileSync(new URL("../../static/views/accountShell.html", import.meta.url).pathname, "utf8");

/** Pull the rule block for a selector out of the stylesheet. */
function rule(selector: string): string {
    const idx = css.indexOf(`\n${selector} {`);
    if (idx === -1) return "";
    return css.slice(idx, css.indexOf("}", idx));
}

describe("the strip must not lose hit-testing to Discord's fixed-position app", () => {
    test("is pinned to the top of the viewport", () => {
        const strip = rule("#tesktop-account-tabs-strip");
        expect(strip).toContain("position: fixed");
        expect(strip).toContain("top: 0");
    });

    test("sits above everything Discord renders", () => {
        // Discord's app is position:fixed, so it paints above normal-flow content.
        // Without an explicit z-index the buttons look real and swallow nothing.
        const strip = rule("#tesktop-account-tabs-strip");
        const z = /z-index:\s*(\d+)/.exec(strip);
        expect(z).not.toBeNull();
        expect(Number(z![1])).toBeGreaterThan(1000);
    });

    test("opts out of window drag regions", () => {
        // Anything inside -webkit-app-region: drag is undraggable *and* unclickable.
        expect(rule("#tesktop-account-tabs-strip")).toContain("-webkit-app-region: no-drag");
    });
});

describe("the shell window must not drag the tab bar", () => {
    test("the body is a drag region, so tabs and buttons have to opt out", () => {
        expect(shellHtml).toMatch(/body\s*\{[^}]*-webkit-app-region:\s*drag/);
    });

    test("the no-drag override uses the class names the tab bar actually renders", () => {
        const override = /body\s*\{[^}]*\}\s*\.([\s\S]*?)\{[^}]*-webkit-app-region:\s*no-drag/.exec(shellHtml);
        expect(override).not.toBeNull();

        const selectors = override![1];
        // These are the classes mountAccountTabBar puts on the DOM.
        for (const cls of ["tesktop-account-tab", "tesktop-account-tabs-button"]) {
            expect(selectors).toContain(cls);
        }
    });

    test("does not override selectors the tab bar never renders", () => {
        // `.tab`/`.button` were placeholders that matched nothing, which is how the
        // whole bar ended up undraggable and unclickable.
        expect(shellHtml).not.toMatch(/^\s*\.tab,\s*$/m);
        expect(shellHtml).not.toMatch(/^\s*\.button\s*\{/m);
    });
});

describe("the app is pushed clear of the strip", () => {
    test("offsets appMount, the container Discord actually pins", () => {
        // This is the selector the previous Tesktop tabs used and the only part of
        // that approach known to work; #app alone is not enough.
        expect(css).toContain('[class*="appMount"]');
    });

    test("uses a margin on appMount rather than top on #app", () => {
        expect(css).toMatch(/\[class\*="appMount"\]\s*\{[^}]*margin-top/);
    });
});