export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const secret = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
      ?? request.headers.get('X-Email-Api-Secret');
    const expected = typeof process !== 'undefined'
      ? (process.env.EMAIL_API_SECRET || process.env.AUTHORIZATION_KEY)
      : '';
    if (!expected || !secret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    // Timing-safe comparison to prevent timing attacks
    const { timingSafeEqual } = await import('crypto');
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { to, subject, html } = body;

    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, html' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const emailSent = await sendEmailDirectly({ to, subject, html });

    if (!emailSent) {
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in email API:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

const sendEmailDirectly = async ({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> => {
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

