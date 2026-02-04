// routes/setup.js
const express = require("express");
const Subject = require("../models/Subject");
const Timetable = require("../models/Timetable");

const router = express.Router();

// create subject (used once)
router.post("/subject", async (req, res) => {
  try {
    const subject = await Subject.create(req.body);
    res.json(subject);
  } catch (err) {
    console.error("Create subject error:", err);
    res.status(500).json({ error: "Failed to create subject" });
  }
});

// list subjects
router.get("/subjects", async (_req, res) => {
  try {
    const subjects = await Subject.find();
    res.json(subjects);
  } catch (err) {
    console.error("List subjects error:", err);
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
});

// create timetable slot
router.post("/timetable", async (req, res) => {
  try {
    const slot = await Timetable.create(req.body);
    res.json(slot);
  } catch (err) {
    console.error("Create timetable error:", err);
    res.status(500).json({ error: "Failed to create timetable slot" });
  }
});

// list timetable for section
router.get("/timetable/:section", async (req, res) => {
  try {
    const slots = await Timetable.find({
      section: req.params.section,
    }).populate("subject");
    res.json(slots);
  } catch (err) {
    console.error("List timetable error:", err);
    res.status(500).json({ error: "Failed to fetch timetable" });
  }
});

module.exports = router;
