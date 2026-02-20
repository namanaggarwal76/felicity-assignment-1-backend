const nodemailer = require("nodemailer"); // for sedning mails using smtp
const QRCode = require("qrcode"); // generates qr from data
const crypto = require("crypto"); // encryption for qr code data

// creates a transporter object 
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// uses aes-256-cbc encryption, takes data and returns encrypted data and iv
function encryptQRData(data) {
  const algorithm = "aes-256-cbc";
  const key = Buffer.from(process.env.QR_ENCRYPTION_KEY, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    encryptedData: encrypted,
    iv: iv.toString("hex"),
  };
}

// uses same algo, takes encrypted data and iv, returns decrypted data
function decryptQRData(encryptedData, ivHex) {
  const algorithm = "aes-256-cbc";
  const key = Buffer.from(process.env.QR_ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// takes data -> encrypts it -> generates qr code buffer from encrypted data, returns both qr code buffer and encryption details (encrypted data + iv)
async function generateEncryptedQRCode(registrationData) {
  const qrData = JSON.stringify({
    ticketId: registrationData.ticketId,
    userId: registrationData.userId,
    eventId: registrationData.eventId,
    eventName: registrationData.eventName,
    userName: registrationData.userName,
    registrationDate: registrationData.registrationDate,
  });
  const { encryptedData, iv } = encryptQRData(qrData);
  const qrPayload = JSON.stringify({
    data: encryptedData,
    iv: iv,
  });
  const qrCodeBuffer = await QRCode.toBuffer(qrPayload, {
    errorCorrectionLevel: "H", // high error correction 
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

// sends mail 
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
      <body>
        <div class="container">
          <div class="header">
            <h1>Registration Confirmed!</h1>
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
              <h2>Your Entry Pass</h2>
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
        cid: "qrcode",
      },
    ],
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Registration email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Error sending registration email:", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  encryptQRData,
  decryptQRData,
  generateEncryptedQRCode,
  sendRegistrationEmail,
};