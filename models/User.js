const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["student", "teacher"], required: true },

  admissionNo: String, // student
  employeeId: String,  // teacher

  department: String,
  semester: Number,
  section: String,

  photoUrl: String
});

module.exports = mongoose.model("User", userSchema);
