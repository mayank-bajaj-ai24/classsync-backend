// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();
const JWT_SECRET = "classsync-secret"; // move to env later

// demo registration API (for seeding)
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      admissionNo,
      employeeId,
      department,
      semester,
      section,
    } = req.body;

    if (!name || !password || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing =
      admissionNo
        ? await User.findOne({ admissionNo })
        : employeeId
        ? await User.findOne({ employeeId })
        : email
        ? await User.findOne({ email })
        : null;

    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      passwordHash,
      role,
      admissionNo,
      employeeId,
      department,
      semester,
      section,
    });

    res.json({
      id: user._id,
      name: user.name,
      role: user.role,
      admissionNo: user.admissionNo,
      employeeId: user.employeeId,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// login with admission number (student)
router.post("/login/student", async (req, res) => {
  try {
    const { admissionNo, password } = req.body;


     console.log("LOGIN from client:", req.body);  // add this
    if (!admissionNo || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    const user = await User.findOne({ admissionNo, role: "student" });
    if (!user) {
      return res.status(400).json({ error: "Student not found" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        admissionNo: user.admissionNo,
        department: user.department,
        semester: user.semester,
        section: user.section,
      },
    });
  } catch (err) {
    console.error("Student login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// routes/auth.js (only the teacher login part)
router.post("/login/teacher", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    const user = await User.findOne({ email, role: "teacher" });
    if (!user) {
      return res.status(400).json({ error: "Teacher not found" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        email: user.email,
        department: user.department,
      },
    });
  } catch (err) {
    console.error("Teacher login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
