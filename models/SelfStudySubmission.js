// models/SelfStudySubmission.js
const mongoose = require("mongoose");

const SelfStudySubmissionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    fileUrl: {
      type: String, // later: real file upload
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    teacherNote: {
      type: String,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "SelfStudySubmission",
  SelfStudySubmissionSchema
);
