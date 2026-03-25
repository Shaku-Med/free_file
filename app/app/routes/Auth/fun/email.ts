import { getClientIP } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/GetIp';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

interface SecurityInfo {
  ip: string;
  userAgent: string;
  platform: string;
  timestamp: string;
}

export const sendVerificationEmail = async (
  email: string,
  code: string,
  type: 'signup' | 'reset' | 'verify' = 'verify'
): Promise<boolean> => {
  try {
    const subject = type === 'signup' 
      ? 'Verify Your Email - Signup'
      : type === 'reset'
      ? 'Password Reset Verification Code'
      : 'Email Verification Code';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #374151; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #f9fafb; margin: 0; font-size: 20px; font-weight: 600;">Verification Code</h1>
          </div>
          <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 15px; margin-bottom: 16px;">Hello,</p>
            <p style="font-size: 15px; margin-bottom: 20px;">
              ${type === 'signup'
                ? 'Thank you for signing up. Use the code below to complete registration:'
                : type === 'reset'
                ? 'You requested a password reset. Use the code below to reset your password:'
                : 'Use the code below to verify your email:'}
            </p>
            <div style="background: #fff; padding: 16px 24px; border-radius: 6px; text-align: center; margin: 24px 0; border: 1px solid #e5e7eb;">
              <p style="font-size: 28px; font-weight: 600; letter-spacing: 6px; color: #111827; margin: 0; font-family: ui-monospace, monospace;">${code}</p>
            </div>
            <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
              This code will expire in 24 hours. If you didn't request this code, please ignore this email.
            </p>
            <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
              Best regards,<br>
              Memories Team
            </p>
          </div>
        </body>
      </html>
    `;

    return await sendEmailDirectly({ to: email, subject, html });
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
};

export const sendPasswordResetNotification = async (
  email: string,
  request: Request
): Promise<boolean> => {
  try {
    const ipAddress = await getClientIP(request.headers);
    let ip = 'Unknown';
    if (typeof ipAddress === 'string') {
      if (ipAddress === '::1') {
        ip = 'Localhost';
      } else if (ipAddress !== 'unknown') {
        ip = ipAddress;
      }
    } else if (ipAddress === true) {
      const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0].trim();
      ip = forwardedFor || 'Unknown';
    }
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const platform = request.headers.get('sec-ch-ua-platform')?.replace(/"/g, '') || 'Unknown';
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'long'
    });

    const subject = 'Password Reset Completed - Security Alert';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #374151; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #f9fafb; margin: 0; font-size: 20px; font-weight: 600;">Password Reset Completed</h1>
          </div>
          <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 16px; margin-bottom: 20px;">Hello,</p>
            <p style="font-size: 16px; margin-bottom: 20px;">
              Your password has been successfully reset. If you did not perform this action, please secure your account immediately.
            </p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 30px 0; border: 1px solid #e5e7eb;">
              <h2 style="font-size: 18px; margin-top: 0; margin-bottom: 15px; color: #1f2937;">Reset Details:</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Date & Time:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${timestamp} UTC</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">IP Address:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-family: monospace;">${ip}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Platform:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${platform}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">User Agent:</td>
                  <td style="padding: 8px 0; color: #1f2937; font-size: 12px; word-break: break-all;">${userAgent}</td>
                </tr>
              </table>
            </div>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="font-size: 14px; margin: 0; color: #92400e; font-weight: 600;">⚠️ If this wasn't you:</p>
              <ul style="font-size: 14px; color: #92400e; margin: 10px 0 0 20px; padding: 0;">
                <li style="margin-bottom: 8px;">Reset your password immediately using a secure device</li>
                <li style="margin-bottom: 8px;">Review your account activity for any unauthorized access</li>
                <li style="margin-bottom: 8px;">Enable two-factor authentication if available</li>
                <li style="margin-bottom: 8px;">Contact support if you notice any suspicious activity</li>
              </ul>
            </div>

            <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
              For your security, we recommend using a strong, unique password that you don't use elsewhere.
            </p>
            <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
              Best regards,<br>
              Memories Security Team
            </p>
          </div>
        </body>
      </html>
    `;

    return await sendEmailDirectly({ to: email, subject, html });
  } catch (error) {
    console.error('Error sending password reset notification:', error);
    return false;
  }
};

export const sendEmailDirectly = async ({ to, subject, html }: EmailOptions): Promise<boolean> => {
  try {
    if (process.env.EMAIL_SERVICE === 'console') {
      console.log('=== EMAIL ===');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('HTML:', html);
      console.log('============');
      return true;
    }

    if (process.env.EMAIL_SERVICE === 'resend' && process.env.RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'noreply@memories.brozy.org',
          to,
          subject,
          html,
        }),
      });

      return response.ok;
    }

    if (process.env.EMAIL_SERVICE === 'smtp') {
      try {
        // @ts-ignore - nodemailer is an optional dependency
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.EMAIL_FROM || 'noreply@memories.brozy.org',
          to,
          subject,
          html,
        });

        return true;
      } catch (error) {
        console.error('Nodemailer not installed or SMTP configuration error:', error);
        return false;
      }
    }

    console.log('No email service configured. Set EMAIL_SERVICE environment variable.');
    console.log('=== EMAIL (Fallback) ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('============');
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

