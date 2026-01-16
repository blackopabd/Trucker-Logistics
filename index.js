const express = require("express");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

dotenv.config();

const app = express();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: "Too many requests, please try again later."
});

// File upload configuration with security
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype === 'application/pdf' || 
                     file.mimetype === 'application/msword' ||
                     file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF and Word documents are allowed'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS with multiple origins support
const allowedOrigins = [
  process.env.VITE_ORIGIN || "http://localhost:5173",
  "http://localhost:5173",
  "http://localhost:4173"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Email configuration with validation
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify email configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("Email configuration error:", error);
  } else {
    console.log("Email server ready");
  }
});

// Helper: Clean up uploaded file
const cleanupFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting file:', err);
      else console.log('File cleaned up:', filePath);
    });
  }
};

// Helper: Sanitize input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/[<>]/g, '');
};

// -------------------------
app.get("/healthcheck",(req,res)=>{
res.send("work")
})
// Driver Application Endpoint
// -------------------------
app.post("/api/submit-application", limiter, upload.single("resume"), async (req, res) => {
  try {
    console.log("Received driver application");

    // Sanitize inputs
    const sanitizedData = {};
    for (let key in req.body) {
      sanitizedData[key] = sanitizeInput(req.body[key]);
    }

    const {
      firstName, lastName, email, phone, age,
      cdlLicense, otrExperience, yearsExperience,
      cleanRecord, dotPhysical, routeType, homeTime,
      payExpectation, additionalInfo
    } = sanitizedData;

    // Validate required fields
    if (!firstName || !lastName || !email || !phone) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      if (req.file) cleanupFile(req.file.path);
      return res.status(400).json({ error: "Invalid email format" });
    }

    let routes = routeType;
    if (typeof routeType === "string") {
      try {
        routes = JSON.parse(routeType);
      } catch {
        routes = [routeType];
      }
    }

    const emailContent = `
      <h2>New Driver Application Received</h2>
      <p><strong>Name:</strong> ${firstName} ${lastName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Age:</strong> ${age}</p>
      <p><strong>CDL License:</strong> ${cdlLicense}</p>
      <p><strong>OTR Experience:</strong> ${otrExperience}</p>
      <p><strong>Years Experience:</strong> ${yearsExperience}</p>
      <p><strong>Clean Driving Record:</strong> ${cleanRecord}</p>
      <p><strong>DOT Physical:</strong> ${dotPhysical}</p>
      <p><strong>Preferred Routes:</strong> ${Array.isArray(routes) ? routes.join(", ") : routes}</p>
      <p><strong>Home Time:</strong> ${homeTime}</p>
      <p><strong>Salary Expectation:</strong> ${payExpectation}</p>
      <p><strong>Additional Info:</strong> ${additionalInfo || "None"}</p>
    `;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || "bonusday9@gmail.com",
      subject: `New Driver Application: ${firstName} ${lastName}`,
      html: emailContent,
      attachments: req.file ? [{
        filename: req.file.originalname,
        path: req.file.path
      }] : [],
    };

    if (process.env.DISABLE_EMAILS === "1") {
      console.log("Emails disabled. Would send:", mailOptions.subject);
      if (req.file) cleanupFile(req.file.path);
      return res.status(200).json({ message: "Application submitted successfully (test mode)" });
    }

    // Send admin email
    await transporter.sendMail(mailOptions);
    console.log("Admin email sent successfully");

    // Send confirmation to applicant
    if (email) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Application Received - Abc Hires",
        html: `
          <h2>Thank you for your application!</h2>
          <p>Hi ${firstName},</p>
          <p>We have received your driver application and will review it shortly.</p>
          <p>Our team will contact you within 2-3 business days.</p>
          <br>
          <p>Best regards,<br>Abc Hires Team</p>
        `,
      });
      console.log("Confirmation email sent to:", email);
    }

    // Clean up uploaded file after sending
    if (req.file) {
      setTimeout(() => cleanupFile(req.file.path), 5000);
    }

    res.status(200).json({ message: "Application submitted successfully" });

  } catch (error) {
    console.error("Error submitting application:", error);
    
    // Clean up file on error
    if (req.file) cleanupFile(req.file.path);
    
    res.status(500).json({ error: "Error submitting application. Please try again." });
  }
});

// -------------------------
// Company Hiring Endpoint
// -------------------------
app.post("/api/company-hiring", limiter, async (req, res) => {
  try {
    console.log("Received company hiring request");

    // Sanitize inputs
    const sanitizedData = {};
    for (let key in req.body) {
      sanitizedData[key] = sanitizeInput(req.body[key]);
    }

    let {
      companyName, contactPerson, email, phone, website,
      address, city, state, zipCode, industry,
      positions, numberOfDriversNeeded, experienceLevel,
      salary, benefits, jobDescription, additionalInfo
    } = sanitizedData;

    // Validate required fields
    if (!companyName || !contactPerson || !email || !phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Parse positions array
    if (typeof positions === "string") {
      try {
        positions = JSON.parse(positions);
      } catch {
        positions = [positions];
      }
    }

    const emailContent = `
      <h2>New Company Hiring Request</h2>
      <h3>Company Information</h3>
      <p><strong>Company:</strong> ${companyName}</p>
      <p><strong>Industry:</strong> ${industry || "N/A"}</p>
      <p><strong>Contact Person:</strong> ${contactPerson}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Website:</strong> ${website || "N/A"}</p>
      <p><strong>Address:</strong> ${address}, ${city}, ${state} ${zipCode}</p>
      
      <h3>Hiring Details</h3>
      <p><strong>Positions:</strong> ${Array.isArray(positions) ? positions.join(", ") : positions}</p>
      <p><strong>Drivers Needed:</strong> ${numberOfDriversNeeded}</p>
      <p><strong>Experience Required:</strong> ${experienceLevel}</p>
      <p><strong>Salary Range:</strong> ${salary}</p>
      <p><strong>Benefits:</strong> ${benefits || "Not specified"}</p>
      <p><strong>Job Description:</strong> ${jobDescription}</p>
      <p><strong>Additional Info:</strong> ${additionalInfo || "None"}</p>
    `;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || "bonusday9@gmail.com",
      subject: `New Hiring Request: ${companyName}`,
      html: emailContent,
    };

    if (process.env.DISABLE_EMAILS === "1") {
      console.log("Emails disabled. Would send:", mailOptions.subject);
      return res.status(200).json({ message: "Request submitted successfully (test mode)" });
    }

    // Send admin email
    await transporter.sendMail(mailOptions);
    console.log("Admin email sent successfully");

    // Send confirmation to company
    if (email) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Hiring Request Received - Abc Hires",
        html: `
          <h2>Thank you for your interest!</h2>
          <p>Hi ${contactPerson},</p>
          <p>We have received your hiring request for ${numberOfDriversNeeded} driver(s).</p>
          <p>Our recruitment team will review your requirements and contact you within 1-2 business days.</p>
          <br>
          <p>Best regards,<br>Abc Hires Team</p>
        `,
      });
      console.log("Confirmation email sent to:", email);
    }

    res.status(200).json({ message: "Hiring request submitted successfully" });

  } catch (error) {
    console.error("Error submitting hiring request:", error);
    res.status(500).json({ error: "Error submitting hiring request. Please try again." });
  }
});

// -------------------------
// Health Check
// -------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ error: error.message });
  }
  
  res.status(500).json({ error: "Internal server error" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// -------------------------
// Start Server
// -------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📧 Email: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
  console.log(`🔒 CORS: ${allowedOrigins.join(', ')}`);
});