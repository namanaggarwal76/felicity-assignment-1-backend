const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const crypto = require("crypto");

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

function encryptQRData(data) {
  const algorithm = "aes-256-cbc";
  const key = Buffer.from(process.env.QR_ENCRYPTION_KEY, "hex"); // 32 bytes key
  const iv = crypto.randomBytes(16); // Initialization vector

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  return {
    encryptedData: encrypted,
    iv: iv.toString("hex"),
  };
}

function decryptQRData(encryptedData, ivHex) {
  const algorithm = "aes-256-cbc";
  const key = Buffer.from(process.env.QR_ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

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
    registrationDate: registrationData.registrationDate,
  });

  // Encrypt the QR data
  const { encryptedData, iv } = encryptQRData(qrData);

  // Create the encrypted payload for QR code
  const qrPayload = JSON.stringify({
    data: encryptedData,
    iv: iv,
  });

  // Generate QR code as buffer
  const qrCodeBuffer = await QRCode.toBuffer(qrPayload, {
    errorCorrectionLevel: "H",
    type: "png",
    width: 400,
    margin: 2,
  });

  return {
    qrCodeBuffer,
    encryptedData,
    iv,
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
    registrationFee,
  } = options;

  const mailOptions = {
    from: {
      name: "Felicity Event Management",
      address: process.env.EMAIL_USER,
    },
    to: to,
    subject: `Registration Confirmed - ${eventName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          h1 {
            margin: 0;
            font-size: 28px;
          }
          h2 {
            color: #667eea;
            margin-top: 0;
          }
          .details,
          .qr-container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
          }
          .qr-container {
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .detail-row {
            display: flex;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
          }
          .detail-row:last-child {
            border-bottom: none;
          }
          .detail-label {
            font-weight: bold;
            width: 150px;
            color: #667eea;
          }
          .detail-value {
            flex: 1;
          }
        </style>
      </head>

      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Registration Confirmed!</h1>
          </div>

          <div class="content">
            <p>Dear <strong>${userName}</strong>,</p>
            <p>Your registration for <strong>${eventName}</strong> has been confirmed successfully.</p>

            <div class="details">
              <h2>Event Details</h2>

              <div class="detail-row">
                <span class="detail-label">Event Name:</span>
                <span class="detail-value">${eventName}</span>
              </div>

              <div class="detail-row">
                <span class="detail-label">Event Date:</span>
                <span class="detail-value">
                  ${new Date(eventDate).toLocaleString("en-US", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                </span>
              </div>

              ${
                eventLocation
                  ? `
              <div class="detail-row">
                <span class="detail-label">Location:</span>
                <span class="detail-value">${eventLocation}</span>
              </div>
              `
                  : ""
              }

              <div class="detail-row">
                <span class="detail-label">Ticket ID:</span>
                <span class="detail-value"><code>${ticketId}</code></span>
              </div>

              ${
                registrationFee > 0
                  ? `
              <div class="detail-row">
                <span class="detail-label">Registration Fee:</span>
                <span class="detail-value">₹${registrationFee}</span>
              </div>
              `
                  : ""
              }
            </div>

            <div class="qr-container">
              <h2>🎫 Your Entry Pass</h2>
              <img
                src="cid:qrcode"
                alt="QR Code"
                style="max-width: 300px; height: auto;"
              />
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    attachments: [
      {
        filename: "qr-code.png",
        content: qrCodeBuffer,
        cid: "qrcode", // Content ID for embedding in HTML
      },
    ],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Registration email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Error sending registration email:", error.message);
    // Don't throw - just log the error and return failure
    return { success: false, error: error.message };
  }
}

async function verifyEmailConfig() {
  try {
    // Add timeout to prevent hanging
    const verifyWithTimeout = Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 10000)
      )
    ]);
    
    await verifyWithTimeout;
    console.log("✅ Email service is ready to send messages");
    return true;
  } catch (error) {
    console.warn("⚠️ Email service verification failed:", error.message);
    console.warn("⚠️ Server will continue but emails will not be sent");
    return false;
  }
}

module.exports = {
  encryptQRData,
  decryptQRData,
  generateEncryptedQRCode,
  sendRegistrationEmail,
  verifyEmailConfig,
};
