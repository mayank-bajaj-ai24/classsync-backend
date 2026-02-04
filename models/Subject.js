const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  credits: { type: Number, required: true },
  totalHours: { type: Number, required: true }, // lecture + tutorial + practical
  labHours: { type: Number, default: 0 },       // P hours from syllabus
  teacherName: String,
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

module.exports = mongoose.model("Subject", subjectSchema);
