
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { findByEmail, insertUser } = require("../db/index.js");
const config = require("../config");

const router = express.Router();

// Register a new user
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body; // Added name for registration

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }

  try {
    const existingUser = await findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
await insertUser({ id: userId, email, password: hashedPassword, name, role: "user" });
    
    const token = jwt.sign({ sub: userId, role: "user" }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    res.cookie("kelion.token", token, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      domain: config.cookie.domain || undefined,
      maxAge: config.session.maxAgeMs,
      path: "/",
    });
    res.status(201).json({ message: "User registered successfully", token, user: { id: userId, email, name, role: "user" } });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login user
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await findByEmail(email);

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    // Set HttpOnly cookie for web clients
    res.cookie("kelion.token", token, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      domain: config.cookie.domain || undefined,
      maxAge: config.session.maxAgeMs,
      path: "/",
    });

    res.json({ message: "Logged in successfully", token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
