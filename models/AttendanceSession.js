const mongoose = require("mongoose");

const attendanceSessionSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
  date: { type: Date, required: true },
  section: String,
  roomNumber: String,

  sessionCode: String,
  expiresAt: Date,
  durationHours: { type: Number, default: 1 },

  // teacher GPS at start (optional)
  teacherLocation: {
    lat: Number,
    lng: Number,
  },

  presentStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

module.exports = mongoose.model(
  "AttendanceSession",
  attendanceSessionSchema
);
