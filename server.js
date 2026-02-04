// server.js
require("dotenv").config();


const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron");

const authRoutes = require("./routes/auth");
const setupRoutes = require("./routes/setup");
const teacherRoutes = require("./routes/teacher");
const studentRoutes = require("./routes/student");

const AttendanceSession = require("./models/AttendanceSession");
const Subject = require("./models/Subject");
const Timetable = require("./models/Timetable");
const User = require("./models/User");
const Notification = require("./models/Notification");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log("INCOMING REQUEST:", req.method, req.url, req.body);
  next();
});

// AFTER
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("Mongo error", err));


app.use("/api/auth", authRoutes);
app.use("/api/setup", setupRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/student", studentRoutes);


app.get("/", (_req, res) => {
  res.json({ message: "ClassSync backend running" });
});


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// -----------------------
// CRON JOBS / SCHEDULERS
// -----------------------

// helper to compute attendance % per subject per student
// NEW VERSION: for each subject + section, counts all sessions as "held"
// and increments "present" only if the student is in presentStudents.
async function computeSubjectAttendanceMap() {
  // load all attendance sessions with subject + section
  const sessions = await AttendanceSession.find()
    .populate("subject")
    .lean();

  // group sessions by subjectId + section
  // key: "<subjectId>:<section>" -> [sessions...]
  const bySubjSection = {};
  for (const s of sessions) {
    if (!s.subject) continue;
    if (!s.section) continue;

    const key = `${s.subject._id.toString()}:${s.section}`;
    if (!bySubjSection[key]) bySubjSection[key] = [];
    bySubjSection[key].push(s);
  }

  // result structure: { subjectId: { studentId: { present, held } } }
  const perSubjectStudent = {};

  const keys = Object.keys(bySubjSection);
  if (keys.length === 0) {
    return perSubjectStudent;
  }

  for (const key of keys) {
    const [subjId, section] = key.split(":");
    const subjSessions = bySubjSection[key];

    // all students enrolled in this section
    const students = await User.find({ role: "student", section })
      .select("_id admissionNumber")
      .lean();

    if (!perSubjectStudent[subjId]) perSubjectStudent[subjId] = {};
    const map = perSubjectStudent[subjId];

    for (const stu of students) {
      const sid = stu._id.toString();
      if (!map[sid]) map[sid] = { present: 0, held: 0 };

      for (const sess of subjSessions) {
        map[sid].held += 1; // class was held for this section
        const wasPresent = (sess.presentStudents || []).some(
          (p) => p.toString() === sid
        );
        if (wasPresent) {
          map[sid].present += 1;
        }
      }
    }
  }

  return perSubjectStudent;
}

cron.schedule("* * * * *", async () => {
  try {
    console.log(
      "[CRON] Low attendance notification job started at",
      new Date().toISOString()
    );
    const threshold = 75;

    const perSubjectStudent = await computeSubjectAttendanceMap();

    const subjectIds = Object.keys(perSubjectStudent);
    if (subjectIds.length === 0) {
      console.log("[CRON] No sessions to process for attendance");
      return;
    }

    const subjects = await Subject.find({ _id: { $in: subjectIds } }).lean();
    const subjectById = {};
    subjects.forEach((s) => {
      subjectById[s._id.toString()] = s;
    });

    for (const subjId of subjectIds) {
      const subj = subjectById[subjId];
      if (!subj) continue;

      const map = perSubjectStudent[subjId];
      const studentIds = Object.keys(map);
      if (studentIds.length === 0) continue;

      const users = await User.find({ _id: { $in: studentIds } }).lean();

      for (const u of users) {
        if (u.role !== "student") continue;

        const stats = map[u._id.toString()];
        if (!stats || stats.held === 0) continue;

        const percent = (stats.present / stats.held) * 100;

        if (percent < threshold) {
  // how many more full‑attendance classes needed to reach threshold
  const target = threshold; // 75
  const neededRaw =
    ((target * stats.held) - (100 * stats.present)) / (100 - target);
  const neededClasses = Math.max(0, Math.ceil(neededRaw));

  console.log(
    `[CRON] Low attendance: student ${u.admissionNumber} in ${subj.code} = ${percent.toFixed(
      1
    )}%, needs about ${neededClasses} more classes`
  );

  const title = "Low attendance warning";
  const extra =
    neededClasses > 0
      ? ` You need to attend approximately ${neededClasses} more classes in this subject (without missing) to reach ${threshold}%.`
      : "";

  const message = `Your attendance in ${subj.name} (${subj.code}) is ${percent.toFixed(
    1
  )}%, which is below ${threshold}%. Please attend classes regularly.${extra}`;

  await Notification.create({
    userId: u._id,
    role: "student",
    type: "low_attendance",
    title,
    message,
    isRead: false,
    meta: {
      subjectId: subj._id.toString(),
      subjectCode: subj.code,
      percentage: Number(percent.toFixed(1)),
      threshold,
      neededClasses,
    },
  });
}

      }
    }

    console.log("[CRON] Low attendance notification job finished");
  } catch (err) {
    console.error("[CRON] Low attendance job error:", err);
  }
});

// 2) Class schedule reminder notifications
// Runs every 5 minutes; looks for slots starting in next 15 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    console.log("[CRON] Class reminder notification job started");

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0–6

    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    const currentTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const future = new Date(now.getTime() + 15 * 60 * 1000);
    const futureTimeStr = `${pad(future.getHours())}:${pad(
      future.getMinutes()
    )}`;

    const todaySlots = await Timetable.find({ dayOfWeek }).populate("subject");

    const upcomingSlots = todaySlots.filter((slot) => {
      const t = slot.startTime; // "HH:MM"
      return t >= currentTimeStr && t <= futureTimeStr;
    });

    if (upcomingSlots.length === 0) {
      console.log("[CRON] No upcoming slots in next 15 minutes");
      return;
    }

    for (const slot of upcomingSlots) {
      if (!slot.subject) continue;

      const subj = slot.subject;
      const section = slot.section;
      const startTime = slot.startTime;
      const room = slot.roomNumber || "Classroom";

      const students = await User.find({
        role: "student",
        section,
      }).lean();

      const title = "Class starting soon";
      const message = `Your class for ${subj.name} (${subj.code}) is scheduled at ${startTime} in ${room}. Please be on time.`;

      const bulkNotifications = students.map((stu) => ({
        userId: stu._id,
        role: "student",
        type: "class_reminder",
        title,
        message,
        isRead: false,
        meta: {
          subjectId: subj._id.toString(),
          subjectCode: subj.code,
          section,
          startTime,
          room,
        },
      }));

      if (bulkNotifications.length > 0) {
        await Notification.insertMany(bulkNotifications);
      }
    }

    console.log("[CRON] Class reminder notification job finished");
  } catch (err) {
    console.error("[CRON] Class reminder job error:", err);
  }
});

