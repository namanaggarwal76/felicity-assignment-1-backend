const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const crypto = require('crypto');

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

function encryptQRData(data) {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.QR_ENCRYPTION_KEY, 'hex'); // 32 bytes key
  const iv = crypto.randomBytes(16); // Initialization vector
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex')
  };
}

function decryptQRData(encryptedData, ivHex) {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.QR_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

async function generateEncryptedQRCode(registrationData) {
  // Create QR data payload
  const qrData = JSON.stringify({
    ticketId: registrationData.ticketId,
    userId: registrationData.userId,
    eventId: registrationData.eventId,
    eventName: registrationData.eventName,
    userName: registrationData.userName,
    registrationDate: registrationData.registrationDate
  });
  
  // Encrypt the QR data
  const { encryptedData, iv } = encryptQRData(qrData);
  
  // Create the encrypted payload for QR code
  const qrPayload = JSON.stringify({
    data: encryptedData,
    iv: iv
  });
  
  // Generate QR code as buffer
  const qrCodeBuffer = await QRCode.toBuffer(qrPayload, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 400,
    margin: 2
  });
  
  return {
    qrCodeBuffer,
    encryptedData,
    iv
  };
}

async function sendRegistrationEmail(options) {
  const {
    to,
    userName,
    eventName,
    eventDate,
    eventLocation,
    ticketId,
    qrCodeBuffer,
    registrationFee
  } = options;
  
  const mailOptions = {
    from: {
      name: 'Felicity Event Management',
      address: process.env.EMAIL_USER
    },
    to: to,
    subject: `Registration Confirmed - ${eventName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .qr-container { text-align: center; margin: 30px 0; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .details { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; }
          .detail-row { display: flex; padding: 10px 0; border-bottom: 1px solid #eee; }
          .detail-label { font-weight: bold; width: 150px; color: #667eea; }
          .detail-value { flex: 1; }
          .footer { text-align: center; margin-top: 30px; padding: 20px; color: #666; font-size: 12px; }
          .important { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px; }
          h1 { margin: 0; font-size: 28px; }
          h2 { color: #667eea; margin-top: 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Registration Confirmed!</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${userName}</strong>,</p>
            <p>Your registration for <strong>${eventName}</strong> has been confirmed successfully!</p>
            
            <div class="details">
              <h2>Event Details</h2>
              <div class="detail-row">
                <span class="detail-label">Event Name:</span>
                <span class="detail-value">${eventName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Event Date:</span>
                <span class="detail-value">${new Date(eventDate).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</span>
              </div>
              ${eventLocation ? `
              <div class="detail-row">
                <span class="detail-label">Location:</span>
                <span class="detail-value">${eventLocation}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Ticket ID:</span>
                <span class="detail-value"><code>${ticketId}</code></span>
              </div>
              ${registrationFee > 0 ? `
              <div class="detail-row">
                <span class="detail-label">Registration Fee:</span>
                <span class="detail-value">₹${registrationFee}</span>
              </div>
              ` : ''}
            </div>
            
            <div class="qr-container">
              <h2>🎫 Your Entry Pass</h2>
              <img src="cid:qrcode" alt="QR Code" style="max-width: 300px; height: auto;" />
              <p style="margin-top: 15px; color: #666; font-size: 14px;">
                <strong>Encrypted QR Code</strong><br>
                Present this QR code at the event entrance for check-in
              </p>
            </div>
            
            <div class="important">
              <strong>⚠️ Important:</strong>
              <ul style="margin: 10px 0;">
                <li>Please bring this QR code (digital or printed) to the event</li>
                <li>This QR code is encrypted and unique to your registration</li>
                <li>Do not share this QR code with others</li>
                <li>Screenshots of this email are acceptable for entry</li>
              </ul>
            </div>
            
            <p>If you have any questions or need assistance, please contact us.</p>
            <p>We look forward to seeing you at the event!</p>
            
            <p style="margin-top: 30px;">
              Best regards,<br>
              <strong>Felicity Event Management Team</strong>
            </p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>&copy; 2026 Felicity Event Management. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    attachments: [
      {
        filename: 'qr-code.png',
        content: qrCodeBuffer,
        cid: 'qrcode' // Content ID for embedding in HTML
      }
    ]
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Registration email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending registration email:', error);
    throw error;
  }
}

/**
 * Verify transporter configuration
 */
async function verifyEmailConfig() {
  try {
    await transporter.verify();
    console.log('Email service is ready to send messages');
    return true;
  } catch (error) {
    console.error('Email service verification failed:', error);
    return false;
  }
}

module.exports = {
  encryptQRData,
  decryptQRData,
  generateEncryptedQRCode,
  sendRegistrationEmail,
  verifyEmailConfig
};
