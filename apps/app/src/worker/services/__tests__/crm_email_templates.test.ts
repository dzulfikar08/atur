import { describe, expect, it } from "vitest";
import {
  fillPlaceholders,
  getPurpose,
  isKnownPurpose,
  renderFromTemplateSource,
  TEMPLATE_PURPOSES,
  TEMPLATE_VARIABLES,
  textToHtml,
} from "../crm_email_templates";

describe("purpose registry", () => {
  it("has all six CRM lifecycle purposes with curated defaults", () => {
    const names = TEMPLATE_PURPOSES.map((p) => p.name);
    expect(names).toEqual([
      "cold_outreach",
      "welcome",
      "feedback_request",
      "follow_up",
      "thank_you",
      "win_back",
    ]);
    for (const p of TEMPLATE_PURPOSES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.default.subject.length).toBeGreaterThan(0);
      expect(p.default.body).toContain("{{footer}}");
    }
  });

  it("getPurpose / isKnownPurpose resolve and reject", () => {
    expect(getPurpose("cold_outreach")?.label).toBe("Cold Outreach");
    expect(isKnownPurpose("follow_up")).toBe(true);
    expect(getPurposeSafe("nope")).toBeNull();
    expect(isKnownPurpose("nope")).toBe(false);
  });

  it("every {{variable}} used by curated defaults is declared in TEMPLATE_VARIABLES", () => {
    const declared = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));
    for (const p of TEMPLATE_PURPOSES) {
      const used = `${p.default.subject} ${p.default.body}`.match(/\{\{(\w+)\}\}/g) ?? [];
      for (const u of used) {
        expect(declared.has(u.slice(2, -2)), `${p.name} uses undeclared ${u}`).toBe(true);
      }
    }
  });
});

describe("fillPlaceholders", () => {
  it("substitutes known keys", () => {
    expect(fillPlaceholders("Hi {{name}}, {{name}}!", { name: "Ada" })).toBe("Hi Ada, Ada!");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(fillPlaceholders("Hi {{name}} {{bogus}}", { name: "Ada" })).toBe("Hi Ada {{bogus}}");
  });

  it("substitutes empty-string values (not undefined)", () => {
    expect(fillPlaceholders("[{{product}}]", { product: "" })).toBe("[]");
  });
});

describe("textToHtml", () => {
  it("escapes HTML special characters", () => {
    expect(textToHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("converts newlines to <br/>", () => {
    expect(textToHtml("a\nb")).toBe("a<br/>\nb");
  });
});

describe("renderFromTemplateSource", () => {
  it("fills customer + purchase variables", () => {
    const rendered = renderFromTemplateSource(
      { subject: "Hi {{name}}", body: "{{product}} on {{date}} for {{amount}}" },
      { name: "Ada", email: "ada@example.com", company: null },
      {
        date: "2026-08-20T00:00:00Z",
        amountCents: 9900,
        currency: "USD",
        productName: "Widget",
      },
    );
    expect(rendered.subject).toBe("Hi Ada");
    expect(rendered.text).toContain("Widget");
    expect(rendered.text).toContain("$99.00");
    // US long-form date, stable in en-US locale
    expect(rendered.text).toMatch(/August \d{1,2}, 2026/);
  });

  it("falls back to email local-part when name is missing", () => {
    const rendered = renderFromTemplateSource(
      { subject: "Hi {{name}}", body: "x" },
      { name: null, email: "ada@example.com", company: null },
      null,
    );
    expect(rendered.subject).toBe("Hi ada");
  });

  it("escapes a hostile subject in the HTML <title>", () => {
    const rendered = renderFromTemplateSource(
      { subject: "</title><script>alert(1)</script>", body: "hello" },
      { name: null, email: null, company: null },
      null,
    );
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;/title&gt;");
  });

  it("escapes hostile body content in the HTML part", () => {
    const rendered = renderFromTemplateSource(
      { subject: "s", body: "<img src=x onerror=alert(1)>" },
      { name: null, email: null, company: null },
      null,
    );
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).toContain("&lt;img src=x");
  });
});

describe("renderFromTemplateSource — footer + is_html", () => {
  const ctx = { name: "Ada", email: "ada@example.com", company: "Acme" };

  it("fills {{footer}} from the workspace footer param", () => {
    const rendered = renderFromTemplateSource(
      { subject: "s", body: "Thanks!\n{{footer}}" },
      ctx,
      null,
      "Regards,\nAcme team",
    );
    expect(rendered.text).toContain("Regards,\nAcme team");
  });

  it("falls back to the neutral default footer", () => {
    const rendered = renderFromTemplateSource({ subject: "s", body: "{{footer}}" }, ctx, null);
    expect(rendered.text).toContain("Regards");
    expect(rendered.text).not.toContain("Dzulfikar");
    expect(rendered.text).not.toContain("Voltrus");
  });

  it("passes is_html bodies through verbatim (placeholders still filled)", () => {
    const rendered = renderFromTemplateSource(
      { subject: "s", body: '<b>Hi {{name}}</b><img src="x">', isHtml: true },
      ctx,
      null,
    );
    expect(rendered.html).toContain("<b>Hi Ada</b>");
    expect(rendered.html).toContain('<img src="x">');
  });

  it("fills {{company}} for cold outreach", () => {
    const def = getPurpose("cold_outreach")!;
    const rendered = renderFromTemplateSource(def.default, ctx, null);
    expect(rendered.text).toContain("Acme");
  });
});

// Local helper so the null-case reads without ts-expect-error noise.
function getPurposeSafe(name: string) {
  return getPurpose(name);
}
