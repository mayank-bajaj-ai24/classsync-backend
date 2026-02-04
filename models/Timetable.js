const mongoose = require("mongoose");

const timetableSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
  dayOfWeek: Number,    // 1=Mon ... 6=Sat
  startTime: String,    // "09:00"
  endTime: String,      // "10:00"
  roomNumber: String,
  section: String       // e.g., "3A"
});

const Timetable = mongoose.model("Timetable", timetableSchema);

module.exports = Timetable;
