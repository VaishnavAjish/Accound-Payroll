const nodemailer = require('nodemailer');

let testAccount = null;
let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  // Use Production SMTP if credentials are provided in .env
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp-mail.outlook.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  }

  // Use Ethereal for testing/development if no credentials provided
  testAccount = await nodemailer.createTestAccount();
  
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: testAccount.user, // generated ethereal user
      pass: testAccount.pass, // generated ethereal password
    },
  });

  return transporter;
}

/**
 * Sends an email and logs the preview URL (Ethereal only)
 */
async function sendMail({ to, subject, text, html }) {
  try {
    const tp = await getTransporter();
    
    const fromAddress = process.env.SMTP_FROM || (process.env.SMTP_USER ? `"Account Payroll" <${process.env.SMTP_USER}>` : '"Account Payroll" <noreply@accountpayroll.local>');
    
    const info = await tp.sendMail({
      from: fromAddress,
      to,
      subject,
      text,
      html,
    });

    console.log('Message sent: %s', info.messageId);
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    
    return info;
  } catch (err) {
    console.error('Error sending mail:', err);
    throw err;
  }
}

module.exports = { sendMail };
