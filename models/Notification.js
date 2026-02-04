// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["student", "teacher"],
      default: "student",
    },
    type: {
      type: String,
      enum: [
        "low_attendance",      // below threshold for a subject or overall
        "class_reminder",      // upcoming class reminder
        "general",             // adhoc info
        "attendance_request",  // NEW – student -> teacher
        "selfstudy_request",   // NEW – student -> teacher
        "attendance_decision", // NEW – teacher -> student
        "selfstudy_decision",  // NEW – teacher -> student
      ],
      default: "general",
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    // OPTIONAL JSON payload (subjectCode, percentage, startTime, etc.)
    meta: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

module.exports = mongoose.model("Notification", notificationSchema);
