import { describe, expect, it } from "vitest";
import {
  fillPlaceholders,
  getDefaultTemplate,
  renderFromTemplateSource,
  textToHtml,
} from "../crm_email_templates";

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
    expect(textToHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
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
  const ctx = { name: "Ada", email: "ada@example.com", company: null };

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
});

describe("getDefaultTemplate", () => {
  it("returns the feedback_request default", () => {
    const def = getDefaultTemplate("feedback_request");
    expect(def).not.toBeNull();
    expect(def!.subject).toContain("{{name}}");
  });

  it("returns null for unknown names", () => {
    // @ts-expect-error runtime guard for route params cast to TemplateName
    expect(getDefaultTemplate("nope")).toBeNull();
  });
});
