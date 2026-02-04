// routes/student.js
const mongoose = require("mongoose");

const express = require("express");
const AttendanceSession = require("../models/AttendanceSession");
const Subject = require("../models/Subject");
const Timetable = require("../models/Timetable");
const AttendanceRequest = require("../models/AttendanceRequest");
const User = require("../models/User");
const SelfStudySubmission = require("../models/SelfStudySubmission");
const Notification = require("../models/Notification");

const router = express.Router();

// helper: distance between two lat/lng points in meters
function distanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// mark attendance via QR + time + range
// body: { studentId, sessionCode, lat, lng }
router.post("/mark-attendance", async (req, res) => {
  try {
    let { studentId, sessionCode, lat, lng } = req.body;

    if (!studentId || !sessionCode) {
      return res
        .status(400)
        .json({ error: "studentId and sessionCode are required" });
    }

    if (lat !== undefined && lat !== null) lat = Number(lat);
    if (lng !== undefined && lng !== null) lng = Number(lng);

    const session = await AttendanceSession.findOne({ sessionCode }).populate(
      "subject"
    );

    if (!session) {
      return res.status(400).json({ error: "Invalid session code" });
    }

    const now = new Date();

    if (session.date && now < session.date) {
      return res.status(400).json({ error: "Session not started yet" });
    }
    if (session.expiresAt && now > session.expiresAt) {
      return res.status(400).json({ error: "Session expired" });
    }

    // NEW: always require student location and enforce distance,
    // assuming teacherLocation is always set when session is created.
    if (
      !session.teacherLocation ||
      session.teacherLocation.lat == null ||
      session.teacherLocation.lng == null
    ) {
      return res.status(400).json({
        error: "Teacher location not set for this session",
      });
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        error: "Location permission required to mark attendance",
      });
    }

    const d = distanceInMeters(
      session.teacherLocation.lat,
      session.teacherLocation.lng,
      lat,
      lng
    );
    const MAX_DISTANCE = 60; // meters

    if (d > MAX_DISTANCE) {
      return res
        .status(400)
        .json({ error: "You are too far from the classroom" });
    }

    if (session.presentStudents.map(String).includes(studentId)) {
      return res
        .status(400)
        .json({ error: "Attendance already marked for this session" });
    }

    session.presentStudents.push(studentId);
    await session.save();

    res.json({
      message: "Attendance marked",
      subject: session.subject ? session.subject.name : undefined,
    });
  } catch (err) {
    console.error("Mark attendance error:", err);
    res.status(500).json({ error: "Failed to mark attendance" });
  }
});

// credit-based attendance summary (kept as-is)
router.get("/attendance-summary/:studentId", async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const sessions = await AttendanceSession.find().populate("subject");

    const subjectStats = {};

    sessions.forEach((s) => {
      const subj = s.subject;
      if (!subj) return;
      const key = subj._id.toString();
      if (!subjectStats[key]) {
        subjectStats[key] = {
          subjectId: subj._id,
          subjectName: subj.name,
          code: subj.code,
          credits: subj.credits,
          totalHours: subj.totalHours,
          labHours: subj.labHours,
          presentHours: 0,
        };
      }
      if (s.presentStudents.map(String).includes(studentId)) {
        subjectStats[key].presentHours += s.durationHours || 1;
      }
    });

    let totalHours = 0;
    let presentHours = 0;

    Object.values(subjectStats).forEach((st) => {
      totalHours += st.totalHours;
      presentHours += st.presentHours;
      st.percentage =
        st.totalHours === 0
          ? 0
          : Math.round((st.presentHours / st.totalHours) * 100);
      const safe = 75;
      st.maxMissableHours =
        st.presentHours === 0
          ? 0
          : Math.max(
              0,
              Math.floor(st.presentHours / (safe / 100) - st.totalHours)
            );
    });

    const overallPercentage =
      totalHours === 0 ? 0 : Math.round((presentHours / totalHours) * 100);

    res.json({ overallPercentage, subjects: subjectStats });
  } catch (err) {
    console.error("Student summary error:", err);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// today's timetable for a section
router.get("/today-timetable/:section", async (req, res) => {
  try {
    const today = new Date().getDay();
    const slots = await Timetable.find({
      section: req.params.section,
      dayOfWeek: today,
    }).populate("subject");
    res.json(slots);
  } catch (err) {
    console.error("Today timetable error:", err);
    res.status(500).json({ error: "Failed to fetch timetable" });
  }
});

// full weekly timetable for a section
router.get("/timetable/:section", async (req, res) => {
  try {
    const section = req.params.section;

    const slots = await Timetable.find({ section }).populate("subject");

    const byDay = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };

    slots.forEach((slot) => {
      if (!slot.subject) return;
      const day = slot.dayOfWeek;
      if (day === undefined || day === null) return;
      byDay[day] = byDay[day] || [];
      byDay[day].push({
        id: slot._id.toString(),
        subjectCode: slot.subject.code,
        subjectName: slot.subject.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        roomNumber: slot.roomNumber,
      });
    });

    Object.keys(byDay).forEach((d) => {
      byDay[d].sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
    });

    res.json(byDay);
  } catch (err) {
    console.error("Section timetable error:", err);
    res.status(500).json({ error: "Failed to fetch section timetable" });
  }
});

// upcoming class (within same day)
router.get("/upcoming-class/:section", async (req, res) => {
  try {
    const now = new Date();
    const day = now.getDay();
    const currentTime = now.toTimeString().slice(0, 5);

    const slots = await Timetable.find({
      section: req.params.section,
      dayOfWeek: day,
    }).populate("subject");

    const upcoming = slots.find((slot) => slot.startTime >= currentTime);
    res.json(upcoming || null);
  } catch (err) {
    console.error("Upcoming class error:", err);
    res.status(500).json({ error: "Failed to fetch upcoming class" });
  }
});

// submit attendance correction request
router.post("/attendance-request", async (req, res) => {
  try {
    const { studentId, subjectId, type, reason, dateFrom, dateTo } = req.body;

    const request = await AttendanceRequest.create({
      student: studentId,
      subject: subjectId,
      type,
      reason,
      dateFrom,
      dateTo,
    });

    // ------------ NEW: notify teacher(s) ------------
    const subject = await Subject.findById(subjectId).lean();
    const student = await User.findById(studentId).lean();

    // Subject stores teacher as teacherId
    const teacherId = subject?.teacherId;

    if (subject && teacherId) {
      const title = "Attendance correction request";
      const message = `${student?.name || "A student"} has submitted an attendance correction request for ${subject.name} (${subject.code}) from ${new Date(
        dateFrom
      )
        .toISOString()
        .slice(0, 10)} to ${new Date(dateTo)
        .toISOString()
        .slice(0, 10)}.`;

      await Notification.create({
        userId: teacherId,
        role: "teacher",
        type: "attendance_request",
        title,
        message,
        isRead: false,
        meta: {
          requestId: request._id.toString(),
          studentId: studentId,
          subjectId: subjectId,
          type,
        },
      });
    }
    // ------------------------------------------------

    res.json(request);
  } catch (err) {
    console.error("Attendance request error", err);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

// list student's own requests
router.get("/attendance-requests/:studentId", async (req, res) => {
  try {
    const requests = await AttendanceRequest.find({
      student: req.params.studentId,
    })
      .populate("subject")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error("Student requests error", err);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

// create self-study submission
router.post("/self-study", async (req, res) => {
  try {
    const { studentId, subjectCode, date, description, fileUrl } = req.body;

    if (!studentId || !subjectCode || !date) {
      return res
        .status(400)
        .json({ error: "studentId, subjectCode and date are required" });
    }

    const subject = await Subject.findOne({ code: subjectCode });
    if (!subject) {
      return res.status(400).json({ error: "Invalid subject code" });
    }

    const submission = await SelfStudySubmission.create({
      student: studentId,
      subject: subject._id,
      date: new Date(date),
      description,
      fileUrl,
    });

    // ------------ NEW: notify teacher(s) ------------
    const student = await User.findById(studentId).lean();

    // Subject stores teacher as teacherId
    const teacherId = subject?.teacherId;

    if (teacherId) {
      const title = "Self-study submission";
      const message = `${student?.name || "A student"} submitted a self-study for ${subject.name} (${subject.code}) on ${new Date(
        date
      )
        .toISOString()
        .slice(0, 10)}.`;

      await Notification.create({
        userId: teacherId,
        role: "teacher",
        type: "selfstudy_request",
        title,
        message,
        isRead: false,
        meta: {
          submissionId: submission._id.toString(),
          studentId,
          subjectId: subject._id.toString(),
        },
      });
    }
    // ------------------------------------------------

    res.json(submission);
  } catch (err) {
    console.error("Self-study create error", err);
    res.status(500).json({ error: "Failed to create self-study submission" });
  }
});

// list student's self-study submissions
router.get("/self-study/:studentId", async (req, res) => {
  try {
    const studentId = req.params.studentId;

    const submissions = await SelfStudySubmission.find({ student: studentId })
      .populate("subject")
      .sort({ createdAt: -1 });

    const result = submissions.map((s) => ({
      id: s._id.toString(),
      subjectCode: s.subject.code,
      subjectName: s.subject.name,
      date: s.date.toISOString().slice(0, 10),
      description: s.description,
      fileUrl: s.fileUrl,
      status: s.status,
      teacherNote: s.teacherNote || "",
    }));

    res.json(result);
  } catch (err) {
    console.error("Self-study list error", err);
    res.status(500).json({ error: "Failed to fetch self-study submissions" });
  }
});

// GET /api/student/overview/:studentId
router.get("/overview/:studentId", async (req, res) => {
  try {
    const studentId = req.params.studentId;

    const student = await User.findById(studentId);
    if (!student || student.role !== "student") {
      return res.status(404).json({ error: "Student not found" });
    }    const today = new Date();
    const dayOfWeek = today.getDay();

    const slots = await Timetable.find({
      section: student.section,
      dayOfWeek,
    }).populate("subject");

    const todaySchedule = slots
      .filter((slot) => slot.subject)
      .map((slot) => ({
        id: slot._id.toString(),
        subjectCode: slot.subject.code,
        subjectName: slot.subject.name,
        start: slot.startTime,
        end: slot.endTime,
        room: slot.roomNumber,
        teacher: slot.subject.teacherName || "Faculty",
      }));

    const sectionSlots = await Timetable.find({
      section: student.section,
    }).populate("subject");

    const subjectStats = {};
    sectionSlots.forEach((slot) => {
      const subj = slot.subject;
      if (!subj) return;
      const key = subj._id.toString();
      if (!subjectStats[key]) {
        subjectStats[key] = {
          subjectId: subj._id,
          subjectName: subj.name,
          subjectCode: subj.code,
          attendancePercent: 0,
          lastAttended: null,
          classesNeededText: "On track",
          classesHeld: 0,
          classesPresent: 0,
          classesThisMonthHeld: 0,
          classesThisMonthPresent: 0,
          streakDays: 0,
        };
      }
    });

    const sessions = await AttendanceSession.find().populate("subject");

    let totalHeld = 0;
    let totalPresent = 0;

    const now = new Date();
    const perSubjectSessions = {};

    sessions.forEach((s) => {
      const subj = s.subject;
      if (!subj) return;
      const key = subj._id.toString();
      if (!subjectStats[key]) return;

      const date = s.date || s.createdAt;
      const isPresent = (s.presentStudents || [])
        .map((id) => id.toString())
        .includes(studentId);

      if (!perSubjectSessions[key]) perSubjectSessions[key] = [];
      perSubjectSessions[key].push({ date, isPresent });

      subjectStats[key].classesHeld += 1;
      totalHeld += 1;

      if (
        date &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      ) {
        subjectStats[key].classesThisMonthHeld += 1;
        if (isPresent) {
          subjectStats[key].classesThisMonthPresent += 1;
        }
      }

      if (isPresent) {
        subjectStats[key].classesPresent += 1;
        totalPresent += 1;
        subjectStats[key].lastAttended = date
          ? date.toISOString().slice(0, 10)
          : null;
      }
    });

    Object.values(subjectStats).forEach((st) => {
      st.attendancePercent =
        st.classesHeld === 0
          ? 0
          : (st.classesPresent / st.classesHeld) * 100;

      st.classesNeededText =
        st.attendancePercent < 75
          ? "Need more classes to reach 75%"
          : "On track";

      const key = st.subjectId.toString();
      const list = (perSubjectSessions[key] || [])
        .filter((x) => x.date)
        .sort((a, b) => b.date - a.date);

      let streak = 0;
      for (const sess of list) {
        if (sess.isPresent) streak += 1;
        else break;
      }
      st.streakDays = streak;

      st.classesThisMonth = st.classesThisMonthPresent;
    });

    const overallAttendance =
      totalHeld === 0 ? 0 : (totalPresent / totalHeld) * 100;
    
    
        // ---- build priority alerts for low attendance ----
    const priorityAlerts = [];

    Object.values(subjectStats).forEach((st) => {
      if (st.attendancePercent < 75) {
        priorityAlerts.push({
          id: `low-${st.subjectId.toString()}`,
          type: "low_attendance",
          title: `Low attendance in ${st.subjectName}`,
          description: `Your attendance in ${st.subjectCode} is ${st.attendancePercent.toFixed(
            1
          )}%, which is below 75%.`,
        });
      }
    });

    // optional: overall low attendance alert
    if (overallAttendance < 75) {
      priorityAlerts.push({
        id: "low-overall",
        type: "low_attendance",
        title: "Overall attendance is low",
        description: `Your overall attendance is ${overallAttendance.toFixed(
          1
        )}%, which is below 75%.`,
      });
    }
    // ---------------------------------------------------




    res.json({
  student: {
    id: student._id.toString(),
    name: student.name,
    admissionNo: student.admissionNo,
    department: student.department,
    semester: student.semester,
    section: student.section,
  },
  priorityAlerts,               // <- use the computed alerts
  subjects: Object.values(subjectStats),
  quickStats: {
    overallAttendance,
    classesHeld: totalHeld,
    classesAttended: totalPresent,
    streakDays: 0,
  },
  todaySchedule,
});

  } catch (err) {
    console.error("Student overview error:", err);
    console.error(err.stack);
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});

// GET /api/student/subject-history/:studentId/:subjectCode
router.get("/subject-history/:studentId/:subjectCode", async (req, res) => {
  try {
    const { studentId, subjectCode } = req.params;

    const subject = await Subject.findOne({ code: subjectCode });
    if (!subject) {
      return res.status(404).json({ error: "Subject not found" });
    }

    const sessions = await AttendanceSession.find({
      subject: subject._id,
    })
      .sort({ date: -1 })
      .lean();

    const history = sessions.map((s) => {
      const date = s.date || s.createdAt;
      const isPresent = (s.presentStudents || [])
        .map((id) => id.toString())
        .includes(studentId);

      return {
        id: s._id.toString(),
        date: date ? date.toISOString().slice(0, 10) : null,
        status: isPresent ? "Present" : "Absent",
        topic: s.topic || "",
        roomNumber: s.roomNumber || "",
      };
    });

    res.json({ subjectCode, history });
  } catch (err) {
    console.error("Subject history error", err);
    res.status(500).json({ error: "Failed to fetch subject history" });
  }
});

// GET /api/student/notifications/:studentId
router.get("/notifications/:studentId", async (req, res) => {
  try {
    const studentId = req.params.studentId;

    const notifications = await Notification.find({
      userId: studentId,
      role: "student",
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(
      notifications.map((n) => ({
        id: n._id.toString(),
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt,
        meta: n.meta || {},
      }))
    );
  } catch (err) {
    console.error("Student notifications error", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// PATCH /api/student/notifications/mark-read
// body: { notificationIds: [id1, id2, ...] }
router.patch("/notifications/mark-read", async (req, res) => {
  try {
    const { notificationIds } = req.body;
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({ error: "notificationIds required" });
    }

    await Notification.updateMany(
      { _id: { $in: notificationIds } },
      { $set: { isRead: true } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Mark notifications read error:", err);
    res.status(500).json({ error: "Failed to mark notifications read" });
  }
});

module.exports = router;
