/**
 * Transactional email templates.
 *
 * Email clients ignore <style> blocks and modern CSS inconsistently, so the
 * markup is table-based with inline styles only.
 */

const BRAND = {
  name: "Orange Tree LMS",
  primary: "#9A5B18",
  primarySoft: "#FBF3EA",
  text: "#1F2937",
  muted: "#6B7280",
  border: "#E5E7EB",
  background: "#F4F1EC",
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const OTP_PURPOSES = {
  verify: {
    subject: "Verify your Orange Tree LMS account",
    heading: "Verify your email address",
    intro:
      "Thanks for signing up! Use the verification code below to activate your account.",
    ignoreNote:
      "If you didn't create an Orange Tree LMS account, you can safely ignore this email.",
  },
  reset: {
    subject: "Your Orange Tree LMS password reset code",
    heading: "Reset your password",
    intro:
      "We received a request to reset the password for your account. Use the code below to continue.",
    ignoreNote:
      "If you didn't request a password reset, you can safely ignore this email — your password will stay the same.",
  },
};

/**
 * Build the OTP email for account verification or password reset.
 *
 * @param {object} params
 * @param {"verify"|"reset"} params.purpose
 * @param {string} params.otp
 * @param {number} params.expiresInMinutes
 * @param {string} [params.name]
 * @returns {{ subject: string, html: string }}
 */
const otpEmail = ({ purpose, otp, expiresInMinutes, name }) => {
  const copy = OTP_PURPOSES[purpose];
  if (!copy) throw new Error(`Unknown OTP email purpose: ${purpose}`);

  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const code = escapeHtml(otp);
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.background};font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${code}. It expires in ${expiresInMinutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.background};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid ${BRAND.border};">
        <tr>
          <td style="background-color:${BRAND.primary};padding:24px 32px;">
            <span style="font-size:20px;font-weight:bold;color:#FFFFFF;letter-spacing:0.3px;">${BRAND.name}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px 32px;">
            <h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;color:${BRAND.text};">${copy.heading}</h1>
            <p style="margin:0 0 8px 0;font-size:15px;line-height:24px;">${greeting}</p>
            <p style="margin:0;font-size:15px;line-height:24px;color:${BRAND.text};">${copy.intro}</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.primarySoft};border:1px dashed ${BRAND.primary};border-radius:10px;">
              <tr>
                <td align="center" style="padding:18px 28px;">
                  <div style="font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">Your code</div>
                  <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:${BRAND.primary};padding-left:10px;">${code}</div>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0 0;font-size:14px;line-height:20px;color:${BRAND.muted};">
              This code expires in <strong style="color:${BRAND.text};">${expiresInMinutes} minutes</strong>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BRAND.border};">
              <tr>
                <td style="padding-top:20px;font-size:13px;line-height:20px;color:${BRAND.muted};">
                  <p style="margin:0 0 8px 0;">For your security, never share this code with anyone. Orange Tree LMS staff will never ask for it.</p>
                  <p style="margin:0;">${copy.ignoreNote}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0;font-size:12px;line-height:18px;color:${BRAND.muted};">
        &copy; ${year} ${BRAND.name}. This is an automated message — please do not reply.
      </p>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html };
};

module.exports = { otpEmail, escapeHtml };
