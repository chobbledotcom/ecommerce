import { describe, expect, test } from "#test-compat";
import {
  type Field,
  renderError,
  renderField,
  renderFields,
} from "#lib/forms.tsx";
import {
  validatePhone,
} from "#templates/fields.ts";
import {
  expectInvalid,
  expectInvalidForm,
  expectValid,
} from "#test-utils";

/** Helper: build a Field definition with minimal boilerplate. */
const field = (
  overrides: Partial<Field> & { name: string; label: string },
): Field => ({
  type: "text",
  ...overrides,
});

/** Helper: render a field with given overrides and optional value. */
const rendered = (
  overrides: Partial<Field> & { name: string; label: string },
  value?: string,
): string => renderField(field(overrides), value);


describe("forms", () => {
  describe("renderField", () => {
    test("renders text input with label", () => {
      const html = rendered({ name: "username", label: "Username" });
      expect(html).toContain("<label>");
      expect(html).toContain("Username");
      expect(html).toContain('type="text"');
      expect(html).toContain('name="username"');
      expect(html).toContain("</label>");
    });

    test("renders required attribute", () => {
      const html = rendered({ name: "email", label: "Email", type: "email", required: true });
      expect(html).toContain("required");
    });

    test("renders placeholder", () => {
      const html = rendered({ name: "name", label: "Name", placeholder: "Enter your name" });
      expect(html).toContain('placeholder="Enter your name"');
    });

    test("renders hint text", () => {
      const html = rendered({ name: "password", label: "Password", type: "password", hint: "Minimum 8 characters" });
      expect(html).toContain("Minimum 8 characters");
      expect(html).toContain("<small");
    });

    test("renders min attribute for number", () => {
      const html = rendered({ name: "quantity", label: "Quantity", type: "number", min: 1 });
      expect(html).toContain('min="1"');
    });

    test("renders pattern attribute", () => {
      const html = rendered({ name: "code", label: "Code", pattern: "[A-Z]{3}" });
      expect(html).toContain('pattern="[A-Z]{3}"');
    });

    test("renders textarea for textarea type", () => {
      const html = rendered({ name: "description", label: "Description", type: "textarea" });
      expect(html).toContain("<textarea");
      expect(html).toContain('rows="3"');
      expect(html).not.toContain("<input");
    });

    test("renders value when provided", () => {
      const html = rendered({ name: "name", label: "Name" }, "John Doe");
      expect(html).toContain('value="John Doe"');
    });

    test("escapes HTML in value", () => {
      const html = rendered({ name: "name", label: "Name" }, '<script>alert("xss")</script>');
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
    });

    test("renders textarea with value", () => {
      const html = rendered({ name: "description", label: "Description", type: "textarea" }, "Some description");
      expect(html).toContain(">Some description</textarea>");
    });
  });

  describe("renderFields", () => {
    test("renders multiple fields", () => {
      const fields: Field[] = [
        field({ name: "name", label: "Name", required: true }),
        field({ name: "email", label: "Email", type: "email", required: true }),
      ];
      const html = renderFields(fields);
      expect(html).toContain("Name");
      expect(html).toContain("Email");
      expect(html).toContain('name="name"');
      expect(html).toContain('name="email"');
    });

    test("renders fields with values", () => {
      const fields: Field[] = [
        field({ name: "name", label: "Name" }),
        field({ name: "count", label: "Count", type: "number" }),
      ];
      const values = { name: "Test", count: 42 };
      const html = renderFields(fields, values);
      expect(html).toContain('value="Test"');
      expect(html).toContain('value="42"');
    });

    test("handles null values", () => {
      const fields: Field[] = [field({ name: "price", label: "Price", type: "number" })];
      const html = renderFields(fields, { price: null });
      expect(html).not.toContain('value="null"');
    });
  });

  describe("validateForm", () => {
    const requiredName: Field[] = [field({ name: "name", label: "Name", required: true })];

    test("validates required fields", () => {
      expectInvalid("Name is required")(requiredName, { name: "" });
    });

    test("validates required field with whitespace only", () => {
      expectInvalidForm(requiredName, { name: "   " });
    });

    test("passes validation when required field has value", () => {
      const values = expectValid(requiredName, { name: "John" });
      expect(values.name).toBe("John");
    });

    test("parses number fields", () => {
      const fields: Field[] = [field({ name: "quantity", label: "Quantity", type: "number", required: true })];
      const values = expectValid(fields, { quantity: "42" });
      expect(values.quantity).toBe(42);
    });

    test("returns null for empty optional number", () => {
      const fields: Field[] = [field({ name: "price", label: "Price", type: "number" })];
      const values = expectValid(fields, { price: "" });
      expect(values.price).toBeNull();
    });

    test("returns null for empty optional text", () => {
      const fields: Field[] = [field({ name: "note", label: "Note" })];
      const values = expectValid(fields, { note: "" });
      expect(values.note).toBeNull();
    });

    test("runs custom validate function", () => {
      const fields: Field[] = [
        field({
          name: "code",
          label: "Code",
          required: true,
          validate: (v) => v.length !== 3 ? "Code must be 3 characters" : null,
        }),
      ];
      expectInvalid("Code must be 3 characters")(fields, { code: "AB" });
    });

    test("skips custom validate for empty optional field", () => {
      const fields: Field[] = [
        field({
          name: "code",
          label: "Code",
          validate: (v) => v.length !== 3 ? "Code must be 3 characters" : null,
        }),
      ];
      expectValid(fields, { code: "" });
    });

    test("trims values", () => {
      const values = expectValid(requiredName, { name: "  John  " });
      expect(values.name).toBe("John");
    });
  });

  describe("renderError", () => {
    test("returns empty string when no error", () => {
      expect(renderError()).toBe("");
      expect(renderError(undefined)).toBe("");
    });

    test("renders error message", () => {
      const html = renderError("Something went wrong");
      expect(html).toContain("Something went wrong");
      expect(html).toContain('class="error"');
    });

    test("escapes HTML in error message", () => {
      const html = renderError("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
    });
  });

  describe("renderField select type", () => {
    const colorSelect: Field = {
      name: "color",
      label: "Color",
      type: "select",
      options: [
        { value: "red", label: "Red" },
        { value: "blue", label: "Blue" },
      ],
    };

    test("renders select element with options", () => {
      const html = renderField(colorSelect);
      expect(html).toContain("<select");
      expect(html).toContain('name="color"');
      expect(html).toContain('value="red"');
      expect(html).toContain(">Red</option>");
      expect(html).toContain('value="blue"');
      expect(html).toContain(">Blue</option>");
    });

    test("renders select with selected value", () => {
      const html = renderField(colorSelect, "blue");
      expect(html).toContain('value="blue" selected');
      expect(html).not.toContain('value="red" selected');
    });

    test("renders select with hint", () => {
      const fieldsSelect: Field = {
        name: "fields",
        label: "Contact Fields",
        type: "select",
        hint: "Which contact details to collect",
        options: [
          { value: "email", label: "Email" },
          { value: "phone", label: "Phone Number" },
          { value: "both", label: "Email & Phone Number" },
        ],
      };
      const html = renderField(fieldsSelect);
      expect(html).toContain("Which contact details to collect");
    });
  });

  describe("validatePhone", () => {
    test("accepts valid phone with country code", () => {
      expect(validatePhone("+1 234 567 8900")).toBeNull();
    });

    test("accepts valid phone with parentheses", () => {
      expect(validatePhone("+1 (555) 123-4567")).toBeNull();
    });

    test("accepts valid phone with hyphens", () => {
      expect(validatePhone("+44-20-1234-5678")).toBeNull();
    });

    test("accepts plain digit phone", () => {
      expect(validatePhone("1234567890")).toBeNull();
    });

    test("rejects phone too short", () => {
      expect(validatePhone("123")).not.toBeNull();
    });

    test("rejects phone with letters", () => {
      expect(validatePhone("abc1234567")).not.toBeNull();
    });

    test("rejects empty string", () => {
      expect(validatePhone("")).not.toBeNull();
    });
  });

});
