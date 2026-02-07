import { describe, expect, test } from "#test-compat";
import {
  type Field,
  renderError,
  renderField,
  renderFields,
} from "#lib/forms.tsx";
import {
  parseChangePassword,
  parseCurrencyForm,
  parseInviteUserForm,
  parseJoinForm,
  parseLoginCredentials,
  parseProductForm,
  parseSetupForm,
  parseSquareTokenForm,
  parseSquareWebhookForm,
  parseStripeKeyForm,
  validatePhone,
} from "#templates/fields.ts";
import {
  expectInvalid,
  expectInvalidForm,
  expectValid,
} from "#test-utils";

/** Helper: create URLSearchParams from an object */
const params = (data: Record<string, string>) => new URLSearchParams(data);

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

  describe("typed form parsers", () => {
    describe("parseLoginCredentials", () => {
      test("returns typed credentials from valid form", () => {
        const result = parseLoginCredentials(params({ username: "admin", password: "secret123" }));
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.username).toBe("admin");
          expect(result.password).toBe("secret123");
        }
      });

      test("rejects empty username", () => {
        const result = parseLoginCredentials(params({ username: "", password: "secret123" }));
        expect(result.valid).toBe(false);
      });

      test("rejects empty password", () => {
        const result = parseLoginCredentials(params({ username: "admin", password: "" }));
        expect(result.valid).toBe(false);
      });
    });

    describe("parseSetupForm", () => {
      const validSetup = {
        admin_username: "admin",
        admin_password: "password123",
        admin_password_confirm: "password123",
        currency_code: "USD",
      };

      test("returns typed setup data from valid form", () => {
        const result = parseSetupForm(params(validSetup));
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.username).toBe("admin");
          expect(result.password).toBe("password123");
          expect(result.currency).toBe("USD");
        }
      });

      test("defaults currency to GBP when empty", () => {
        const result = parseSetupForm(params({ ...validSetup, currency_code: "" }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.currency).toBe("GBP");
      });

      test("uppercases currency code", () => {
        const result = parseSetupForm(params({ ...validSetup, currency_code: "eur" }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.currency).toBe("EUR");
      });

      test("rejects password shorter than minimum length", () => {
        const result = parseSetupForm(params({
          ...validSetup,
          admin_password: "short",
          admin_password_confirm: "short",
        }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("at least");
      });

      test("rejects mismatched passwords", () => {
        const result = parseSetupForm(params({
          ...validSetup,
          admin_password_confirm: "different123",
        }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("do not match");
      });

      test("rejects invalid currency code", () => {
        const result = parseSetupForm(params({ ...validSetup, currency_code: "ABCD" }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("Currency code");
      });
    });

    describe("parseJoinForm", () => {
      test("returns password from valid form", () => {
        const result = parseJoinForm(params({
          password: "newpassword1",
          password_confirm: "newpassword1",
        }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.password).toBe("newpassword1");
      });

      test("rejects short password", () => {
        const result = parseJoinForm(params({ password: "short", password_confirm: "short" }));
        expect(result.valid).toBe(false);
      });

      test("rejects mismatched passwords", () => {
        const result = parseJoinForm(params({
          password: "password123",
          password_confirm: "password456",
        }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("do not match");
      });
    });

    describe("parseChangePassword", () => {
      test("returns current and new password from valid form", () => {
        const result = parseChangePassword(params({
          current_password: "oldpass123",
          new_password: "newpass123",
          new_password_confirm: "newpass123",
        }));
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.currentPassword).toBe("oldpass123");
          expect(result.newPassword).toBe("newpass123");
        }
      });

      test("rejects short new password", () => {
        const result = parseChangePassword(params({
          current_password: "oldpass123",
          new_password: "short",
          new_password_confirm: "short",
        }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("New password");
      });
    });

    describe("parseProductForm", () => {
      test("returns typed product data from valid form", () => {
        const result = parseProductForm(params({
          name: "Widget",
          sku: "WIDGET-01",
          description: "A widget",
          unit_price: "1500",
          stock: "10",
          active: "1",
        }));
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.name).toBe("Widget");
          expect(result.sku).toBe("WIDGET-01");
          expect(result.description).toBe("A widget");
          expect(result.unitPrice).toBe(1500);
          expect(result.stock).toBe(10);
          expect(result.active).toBe(1);
        }
      });

      test("defaults active to 1 when not provided", () => {
        const result = parseProductForm(params({
          name: "Widget",
          sku: "WIDGET-01",
          description: "",
          unit_price: "1500",
          stock: "10",
        }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.active).toBe(1);
      });

      test("rejects missing required sku", () => {
        const result = parseProductForm(params({
          name: "Widget",
          sku: "",
          unit_price: "1500",
          stock: "10",
        }));
        expect(result.valid).toBe(false);
      });
    });

    describe("parseInviteUserForm", () => {
      test("returns typed invite data for manager role", () => {
        const result = parseInviteUserForm(params({ username: "newuser", admin_level: "manager" }));
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.username).toBe("newuser");
          expect(result.adminLevel).toBe("manager");
        }
      });

      test("accepts owner role", () => {
        const result = parseInviteUserForm(params({ username: "newuser", admin_level: "owner" }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.adminLevel).toBe("owner");
      });

      test("rejects invalid role", () => {
        const result = parseInviteUserForm(params({ username: "newuser", admin_level: "superadmin" }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toBe("Invalid role");
      });
    });

    describe("parseStripeKeyForm", () => {
      test("returns stripe key from valid form", () => {
        const result = parseStripeKeyForm(params({ stripe_secret_key: "sk_test_123" }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.stripeSecretKey).toBe("sk_test_123");
      });

      test("rejects empty key", () => {
        const result = parseStripeKeyForm(params({ stripe_secret_key: "" }));
        expect(result.valid).toBe(false);
      });
    });

    describe("parseSquareTokenForm", () => {
      test("returns access token and location ID from valid form", () => {
        const result = parseSquareTokenForm(params({
          square_access_token: "EAAAl_test",
          square_location_id: "L_test",
        }));
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.accessToken).toBe("EAAAl_test");
          expect(result.locationId).toBe("L_test");
        }
      });

      test("rejects missing location ID", () => {
        const result = parseSquareTokenForm(params({
          square_access_token: "EAAAl_test",
          square_location_id: "",
        }));
        expect(result.valid).toBe(false);
      });
    });

    describe("parseSquareWebhookForm", () => {
      test("returns signature key from valid form", () => {
        const result = parseSquareWebhookForm(params({ square_webhook_signature_key: "sig_key" }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.signatureKey).toBe("sig_key");
      });
    });

    describe("parseCurrencyForm", () => {
      test("returns uppercased currency code from valid form", () => {
        const result = parseCurrencyForm(params({ currency_code: "eur" }));
        expect(result.valid).toBe(true);
        if (result.valid) expect(result.currencyCode).toBe("EUR");
      });

      test("rejects invalid currency code", () => {
        const result = parseCurrencyForm(params({ currency_code: "1234" }));
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error).toContain("Currency code");
      });

      test("rejects empty currency code", () => {
        const result = parseCurrencyForm(params({ currency_code: "" }));
        expect(result.valid).toBe(false);
      });
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

  describe("parseCurrencyForm", () => {
    test("parseCurrencyForm rejects invalid currency code", async () => {
      const { parseCurrencyForm } = await import("#templates/fields.ts");
      const form = new URLSearchParams({ currency_code: "ab" });
      const result = parseCurrencyForm(form);
      expect(result.valid).toBe(false);
    });

    test("parseCurrencyForm accepts valid 3-letter code", async () => {
      const { parseCurrencyForm } = await import("#templates/fields.ts");
      const form = new URLSearchParams({ currency_code: "usd" });
      const result = parseCurrencyForm(form);
      expect(result.valid).toBe(true);
    });
  });

});
