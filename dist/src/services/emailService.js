import { resend, FROM } from "../config/resend";
// ─── Shared layout ────────────────────────────────────────────────────────────
function layout(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo -->
          <tr>
            <td style="padding-bottom:28px;text-align:center;">
              <span style="font-size:26px;font-weight:900;letter-spacing:-0.04em;color:#ffffff;">
                XOK<span style="background:linear-gradient(135deg,#7c6ff7,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">SIS</span>
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#13131a;border:1px solid #2a2a3a;border-radius:20px;padding:40px 36px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;font-size:12px;color:#4a4a6a;line-height:1.8;">
              XOKSIS · Institute of Modern Technology Skills<br/>
              This email was sent to you because you have an account at xoksis.com<br/>
              <a href="https://xoksis.com" style="color:#7c6ff7;text-decoration:none;">xoksis.com</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
function otpBlock(otp) {
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background:#1a1a2e;border:1px solid #3d3a7a;border-radius:16px;padding:18px 36px;">
            <span style="font-size:38px;font-weight:900;letter-spacing:0.18em;color:#a78bfa;font-family:'Courier New',monospace;">${otp}</span>
          </div>
        </td>
      </tr>
    </table>`;
}
function heading(text) {
    return `<h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">${text}</h1>`;
}
function sub(text) {
    return `<p style="margin:0 0 20px;font-size:15px;color:#8888aa;line-height:1.7;">${text}</p>`;
}
function note(text) {
    return `<p style="margin:20px 0 0;font-size:12px;color:#55556a;line-height:1.7;">${text}</p>`;
}
function divider() {
    return `<hr style="border:none;border-top:1px solid #2a2a3a;margin:24px 0;" />`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function textBlock(text) {
    return `<div style="font-size:15px;color:#8888aa;line-height:1.8;white-space:normal;">${escapeHtml(text).replace(/\r?\n/g, "<br/>")}</div>`;
}
// ─── Email senders ────────────────────────────────────────────────────────────
export async function sendSignupOtp(to, name, otp) {
    const body = `
    ${heading("Verify your email address")}
    ${sub(`Hi ${name}, welcome to XOKSIS! Use the code below to verify your email and activate your account.`)}
    ${otpBlock(otp)}
    ${divider()}
    ${note("This code expires in <strong style='color:#ffffff'>10 minutes</strong>. If you did not create an account, you can safely ignore this email.")}
  `;
    const { data, error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject: "Your XOKSIS verification code",
        html: layout("Verify your email – XOKSIS", body),
        idempotencyKey: `signup-otp/${to}-${otp}`,
    });
    if (error)
        console.error("[sendSignupOtp]", error);
    return { data, error };
}
export async function sendForgotPasswordOtp(to, name, otp) {
    const body = `
    ${heading("Reset your password")}
    ${sub(`Hi ${name}, we received a request to reset your XOKSIS password. Use the code below to proceed.`)}
    ${otpBlock(otp)}
    ${divider()}
    ${note("This code expires in <strong style='color:#ffffff'>10 minutes</strong>. If you did not request a password reset, please ignore this email — your password will not change.")}
  `;
    const { data, error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject: "Reset your XOKSIS password",
        html: layout("Password Reset – XOKSIS", body),
        idempotencyKey: `forgot-password/${to}-${otp}`,
    });
    if (error)
        console.error("[sendForgotPasswordOtp]", error);
    return { data, error };
}
export async function sendWelcomeEmail(to, name) {
    const body = `
    ${heading("Welcome to XOKSIS! 🎉")}
    ${sub(`Hi ${name}, your account is now verified and ready to go. Start exploring our courses and take the first step in your learning journey.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td align="center">
          <a href="https://xoksis.com/courses"
             style="display:inline-block;background:linear-gradient(135deg,#7c6ff7,#a78bfa);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.01em;">
            Explore Courses
          </a>
        </td>
      </tr>
    </table>
    ${divider()}
    <table cellpadding="0" cellspacing="0" width="100%">
      ${[
        ["🎓", "Expert-led courses", "Learn from industry professionals"],
        ["📜", "Certificates", "Earn certificates upon completion"],
        ["💬", "Community", "Join our private Slack workspace"],
    ].map(([icon, title, desc]) => `
        <tr>
          <td style="padding:8px 0;vertical-align:top;width:32px;font-size:20px;">${icon}</td>
          <td style="padding:8px 0 8px 12px;vertical-align:top;">
            <div style="font-size:14px;font-weight:700;color:#ffffff;">${title}</div>
            <div style="font-size:13px;color:#8888aa;">${desc}</div>
          </td>
        </tr>`).join("")}
    </table>
  `;
    const { data, error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject: `Welcome to XOKSIS, ${name}!`,
        html: layout("Welcome to XOKSIS", body),
    });
    if (error)
        console.error("[sendWelcomeEmail]", error);
    return { data, error };
}
export async function sendEnrollmentConfirmation(to, name, courseName, referralCode) {
    const body = `
    ${heading("Application received!")}
    ${sub(`Hi ${name}, we've received your enrollment application for the course below. Our team will review it and reach out via WhatsApp/email with further details.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:#1a1a2e;border:1px solid #3d3a7a;border-radius:14px;padding:18px 22px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#7c6ff7;margin-bottom:6px;text-transform:uppercase;">Selected Course</div>
          <div style="font-size:16px;font-weight:800;color:#ffffff;">${courseName}</div>
        </td>
      </tr>
    </table>
    ${referralCode ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#131326;border:1px dashed #3d3a7a;border-radius:14px;padding:18px 22px;">
      <tr>
        <td>
          <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#a78bfa;margin-bottom:6px;text-transform:uppercase;">🎁 Share & Save Tuition Fee!</div>
          <div style="font-size:14px;color:#8888aa;line-height:1.6;margin-bottom:12px;">
            Invite your friends to study at XOKSIS! If they use your code to register, you'll get <strong>Rs. 500 off</strong> your monthly fee once they join standard tier.
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
            <tr>
              <td align="center" style="background:#0f0f1c;border:1px solid #2a2a3e;padding:12px;border-radius:10px;font-family:monospace;font-size:16px;font-weight:800;color:#ffffff;letter-spacing:0.05em;">
                Referral Code: ${referralCode}
              </td>
            </tr>
          </table>
          <div style="font-size:12px;color:#6e6e8e;text-align:center;">
            Or share link: <a href="https://xoksis.com/enroll?ref=${referralCode}" style="color:#7c6ff7;text-decoration:none;font-weight:700;">xoksis.com/enroll?ref=${referralCode}</a>
          </div>
        </td>
      </tr>
    </table>
    ` : ""}
    ${divider()}
    <table cellpadding="0" cellspacing="0" width="100%">
      ${[
        ["1", "Application Review", "Our admissions team reviews your details (1-2 business days)"],
        ["2", "Team Contact", "We'll reach out via WhatsApp to discuss next steps"],
        ["3", "Enrollment Confirmed", "Complete your registration and begin your journey"],
    ].map(([num, title, desc]) => `
        <tr>
          <td style="padding:10px 0;vertical-align:top;width:36px;">
            <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#7c6ff7,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#fff;text-align:center;line-height:26px;">${num}</div>
          </td>
          <td style="padding:10px 0 10px 12px;vertical-align:top;">
            <div style="font-size:14px;font-weight:700;color:#ffffff;">${title}</div>
            <div style="font-size:13px;color:#8888aa;">${desc}</div>
          </td>
        </tr>`).join("")}
    </table>
    ${note("If you have any questions, reply to this email or contact us at <a href='mailto:info@xoksis.com' style='color:#7c6ff7;text-decoration:none;'>info@xoksis.com</a>")}
  `;
    const { data, error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject: `Enrollment application received – ${courseName}`,
        html: layout("Enrollment Confirmation – XOKSIS", body),
        idempotencyKey: `enrollment/${to}-${courseName.slice(0, 40)}`,
    });
    if (error)
        console.error("[sendEnrollmentConfirmation]", error);
    return { data, error };
}
export async function sendEnrollmentCampaignEmail(to, subject, renderedBody, idempotencyKey) {
    const body = `
    ${heading(subject)}
    ${textBlock(renderedBody)}
    ${divider()}
    ${note("If you have questions, reply to this email or contact us at <a href='mailto:info@xoksis.com' style='color:#7c6ff7;text-decoration:none;'>info@xoksis.com</a>.")}
  `;
    const { data, error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject,
        html: layout(`${subject} - XOKSIS`, body),
        idempotencyKey,
    });
    if (error)
        console.error("[sendEnrollmentCampaignEmail]", error);
    return { data, error };
}
export async function sendReferralUpdateEmail(to, referrerName, refereeName, refereeCourse, newDiscount, newFee) {
    const body = `
    ${heading("Your referral is now active! 🎁")}
    ${sub(`Hi ${referrerName},`)}
    <p style="font-size:15px;color:#8888aa;line-height:1.7;">
      Great news! <strong>${refereeName}</strong>, who used your referral code to register for <strong>${refereeCourse}</strong>, has upgraded to the standard fee tier.
    </p>
    <p style="font-size:15px;color:#8888aa;line-height:1.7;">
      As a result, your tuition fee has been decreased by <strong>Rs. 500</strong>. You now have a total discount of <strong>Rs. ${newDiscount}</strong>, and your monthly tuition fee for your active standard course is now <strong>Rs. ${newFee}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td align="center">
          <a href="https://xoksis.com/dashboard/profile"
             style="display:inline-block;background:linear-gradient(135deg,#7c6ff7,#a78bfa);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.01em;">
            View Your Referrals
          </a>
        </td>
      </tr>
    </table>
    ${divider()}
    ${note("Thank you for referring students to XOKSIS! Keep referring to accumulate more discounts (up to 100% off).")}
  `;
    const { data, error } = await resend.emails.send({
        from: FROM,
        to: [to],
        subject: `Tuition Fee Discount Applied! – XOKSIS`,
        html: layout("Referral Active – XOKSIS", body),
    });
    if (error)
        console.error("[sendReferralUpdateEmail]", error);
    return { data, error };
}
