// routes/teacher.js
const express = require("express");
const AttendanceSession = require("../models/AttendanceSession");
const Subject = require("../models/Subject");
const Timetable = require("../models/Timetable");
const AttendanceRequest = require("../models/AttendanceRequest");
const User = require("../models/User");
const SelfStudySubmission = require("../models/SelfStudySubmission");
const Notification = require("../models/Notification");

const router = express.Router();

/**
 * GET /api/teacher/upcoming/:teacherId
 * Upcoming classes for teacher (today)
 */
router.get("/upcoming/:teacherId", async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    const subjects = await Subject.find({ teacherId });
    const subjectIds = subjects.map((s) => s._id);

    const now = new Date();
    const day = now.getDay(); // 0-6

    const slots = await Timetable.find({
      subject: { $in: subjectIds },
      dayOfWeek: day,
    }).populate("subject");

    res.json(slots);
  } catch (err) {
    console.error("Teacher upcoming error:", err);
    res.status(500).json({ error: "Failed to fetch upcoming classes" });
  }
});

// POST /api/teacher/start-session
router.post("/start-session", async (req, res) => {
  try {
    const { subjectId, section, roomNumber, lat, lng } = req.body;

    // require teacher location
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
      return res
        .status(400)
        .json({ error: "Location permission required to start session" });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const sessionCode = "CS-" + Math.random().toString(36).substring(2, 8);

    const session = await AttendanceSession.create({
      subject: subjectId,
      section,
      roomNumber,
      date: now,
      sessionCode,
      expiresAt,
      durationHours: 1,
      teacherLocation: { lat: numericLat, lng: numericLng },
    });

    res.json({
      _id: session._id,
      subject: subjectId,
      section,
      roomNumber,
      date: session.date,
      sessionCode: session.sessionCode,
      expiresAt: session.expiresAt,
      durationHours: session.durationHours,
      presentStudents: [],
    });
  } catch (err) {
    console.error("Start session error:", err);
    res.status(500).json({ error: "Failed to start session" });
  }
});

/**
 * GET /api/teacher/session/:sessionId
 * Get live session details with student info (name + USN)
 */
router.get("/session/:sessionId", async (req, res) => {
  try {
    const session = await AttendanceSession.findById(req.params.sessionId)
      .populate("subject")
      .populate("presentStudents");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const CLASS_STRENGTH = 60;

    res.json({
      id: session._id.toString(),
      date: session.date.toISOString().slice(0, 10),
      subjectCode: session.subject.code,
      subjectName: session.subject.name,
      roomNumber: session.roomNumber,
      section: session.section,
      sessionCode: session.sessionCode,
      presentCount: session.presentStudents.length,
      total: CLASS_STRENGTH,
      presentStudents: session.presentStudents.map((stu) => ({
        id: stu._id.toString(),
        name: stu.name,
        admissionNo: stu.admissionNo,
      })),
    });
  } catch (err) {
    console.error("Get session error:", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

/**
 * GET /api/teacher/requests/:teacherId
 * View correction requests for this teacher's subjects
 */
router.get("/requests/:teacherId", async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    const subjects = await Subject.find({ teacherId });
    const subjectIds = subjects.map((s) => s._id);

    const requests = await AttendanceRequest.find({
      subject: { $in: subjectIds },
    })
      .populate("student")
      .populate("subject")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error("Teacher requests error:", err);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

/**
 * POST /api/teacher/requests/:requestId/decision
 * Approve / reject correction
 */
router.post("/requests/:requestId/decision", async (req, res) => {
  try {
    const { status, teacherNote } = req.body;

    const request = await AttendanceRequest.findByIdAndUpdate(
      req.params.requestId,
      { status, teacherNote },
      { new: true }
    )
      .populate("student")
      .populate("subject");

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // NEW: notify the student about decision
    const title =
      status === "approved"
        ? "Attendance request approved"
        : status === "rejected"
        ? "Attendance request rejected"
        : "Attendance request updated";

    const msgNote = teacherNote ? ` Note: ${teacherNote}` : "";

    const message = `Your attendance correction request for ${request.subject.name} (${request.subject.code}) from ${request.dateFrom
      .toISOString()
      .slice(0, 10)} to ${request.dateTo
      .toISOString()
      .slice(0, 10)} has been ${status}.${msgNote}`;

    await Notification.create({
      userId: request.student._id,
      role: "student",
      type: "attendance_request",
      title,
      message,
      isRead: false,
      meta: {
        requestId: request._id.toString(),
        status,
      },
    });

    res.json(request);
  } catch (err) {
    console.error("Request decision error:", err);
    res.status(500).json({ error: "Failed to update request" });
  }
});

/**
 * GET /api/teacher/overview/:teacherId
 * Data for TeacherDashboard (teacher info + today's slots + recent sessions)
 */
router.get("/overview/:teacherId", async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    const teacherUser = await User.findById(teacherId);
    if (!teacherUser || teacherUser.role !== "teacher") {
      return res.status(404).json({ error: "Teacher not found" });
    }

    const subjects = await Subject.find({ teacherId: teacherUser._id });
    const subjectIds = subjects.map((s) => s._id);

    const today = new Date();
    const dayOfWeek = today.getDay();

    const slots = await Timetable.find({
      subject: { $in: subjectIds },
      dayOfWeek,
    }).populate("subject");

    const todaySlots = slots.map((slot) => ({
      id: slot._id.toString(),
      subjectCode: slot.subject.code,
      subjectName: slot.subject.name,
      start: slot.startTime,
      end: slot.endTime,
      room: slot.roomNumber,
      section: slot.section,
    }));

    const sessions = await AttendanceSession.find({
      subject: { $in: subjectIds },
    })
      .sort({ date: -1 })
      .limit(10)
      .populate("subject");

    const CLASS_STRENGTH = 60;

    const recentSessions = sessions.map((s) => ({
      id: s._id.toString(),
      date: s.date.toISOString().slice(0, 10),
      subjectCode: s.subject.code,
      subjectName: s.subject.name,
      section: s.section || "",
      roomNumber: s.roomNumber || "",
      present: s.presentStudents.length,
      total: CLASS_STRENGTH,
      percent:
        CLASS_STRENGTH === 0
          ? 0
          : (s.presentStudents.length / CLASS_STRENGTH) * 100,
    }));

    res.json({
      teacher: {
        id: teacherUser._id.toString(),
        name: teacherUser.name,
        department: teacherUser.department || "AIML",
        designation: teacherUser.designation || "Assistant Professor",
        subjects: subjects.map((s) => ({
          id: s._id.toString(),
          subjectName: s.name,
          subjectCode: s.code,
        })),
      },
      todaySlots,
      recentSessions,
    });
  } catch (err) {
    console.error("Teacher overview error:", err);
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});

/**
 * NEW: GET /api/teacher/self-study/:teacherId
 * List pending self-study submissions for this teacher's subjects
 */
router.get("/self-study/:teacherId", async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    const subjects = await Subject.find({ teacherId });
    const subjectIds = subjects.map((s) => s._id);

    const submissions = await SelfStudySubmission.find({
      subject: { $in: subjectIds },
      status: "pending",
    })
      .populate("student")
      .populate("subject")
      .sort({ createdAt: -1 });

    const result = submissions.map((s) => ({
      id: s._id.toString(),
      studentId: s.student._id.toString(),
      studentName: s.student.name,
      admissionNo: s.student.admissionNo,
      subjectCode: s.subject.code,
      subjectName: s.subject.name,
      date: s.date.toISOString().slice(0, 10),
      description: s.description,
      fileUrl: s.fileUrl,
      status: s.status,
    }));

    res.json(result);
  } catch (err) {
    console.error("Teacher self-study list error:", err);
    res.status(500).json({ error: "Failed to fetch self-study submissions" });
  }
});

/**
 * NEW: POST /api/teacher/self-study/:id/decision
 * Approve / reject self-study; if approved, mark attendance via a session
 */
router.post("/self-study/:id/decision", async (req, res) => {
  try {
    const { status, teacherNote } = req.body;

    const submission = await SelfStudySubmission.findByIdAndUpdate(
      req.params.id,
      { status, teacherNote },
      { new: true }
    )
      .populate("student")
      .populate("subject");

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (status === "approved") {
      const CLASS_STRENGTH = 60;

      await AttendanceSession.create({
        subject: submission.subject._id,
        section: submission.student.section,
        roomNumber: "Self-study",
        date: submission.date,
        sessionCode: "SELF-" + submission._id.toString().slice(-6),
        expiresAt: submission.date,
        durationHours: 0,
        presentStudents: [submission.student._id],
        totalStudents: CLASS_STRENGTH,
      });
    }

    // Notify student about decision
    const title =
      status === "approved"
        ? "Self-study approved"
        : status === "rejected"
        ? "Self-study rejected"
        : "Self-study updated";

    const msgNote = teacherNote ? ` Note: ${teacherNote}` : "";
    const message = `Your self-study submission for ${submission.subject.name} (${submission.subject.code}) on ${submission.date
      .toISOString()
      .slice(0, 10)} has been ${status}.${msgNote}`;

    await Notification.create({
      userId: submission.student._id,
      role: "student",
      type: "selfstudy_request",
      title,
      message,
      isRead: false,
      meta: {
        submissionId: submission._id.toString(),
        status,
      },
    });

    res.json({
      id: submission._id.toString(),
      status: submission.status,
      teacherNote: submission.teacherNote || "",
    });
  } catch (err) {
    console.error("Self-study decision error:", err);
    res.status(500).json({ error: "Failed to update submission" });
  }
});

/**
 * GET /api/teacher/session/:sessionId/export
 * Export attendance for this session as CSV
 */
router.get("/session/:sessionId/export", async (req, res) => {
  try {
    const session = await AttendanceSession.findById(req.params.sessionId)
      .populate("subject")
      .populate("presentStudents");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const date = session.date.toISOString().slice(0, 10);
    const subjectCode = session.subject.code;

    let csv = "USN,Name,Subject,Date,Section,Room,Status\n";

    session.presentStudents.forEach((stu) => {
      csv += `${stu.admissionNo},${stu.name},${subjectCode},${date},${session.section},${session.roomNumber},Present\n`;
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attendance-${subjectCode}-${date}.csv"`
    );
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } catch (err) {
    console.error("Export session error:", err);
    res.status(500).json({ error: "Failed to export attendance" });
  }
});

// GET /api/teacher/subject-attendance/:teacherId/:subjectCode
// Returns per-student attendance summary for one subject
router.get("/subject-attendance/:teacherId/:subjectCode", async (req, res) => {
  try {
    const { teacherId, subjectCode } = req.params;

    // 1) Find subject for this teacher
    const subject = await Subject.findOne({
      code: subjectCode,
      teacherId,
    });
    if (!subject) {
      return res
        .status(404)
        .json({ error: "Subject not found for this teacher" });
    }

    const subjectId = subject._id;

    // 2) Get all timetable slots to know which sections this subject is taught to
    const timetableSlots = await Timetable.find({ subject: subjectId }).lean();

    if (timetableSlots.length === 0) {
      return res.json({
        subject: {
          id: subject._id.toString(),
          name: subject.name,
          code: subject.code,
        },
        students: [],
      });
    }

    // Sections for this subject (e.g. "AIML-02-A")
    const sections = Array.from(
      new Set(timetableSlots.map((slot) => slot.section).filter(Boolean))
    );

    // 3) All students in those sections
    const students = await User.find({
      role: "student",
      section: { $in: sections },
    }).lean();

    if (students.length === 0) {
      return res.json({
        subject: {
          id: subject._id.toString(),
          name: subject.name,
          code: subject.code,
        },
        students: [],
      });
    }

    const studentMap = new Map();
    students.forEach((stu) => {
      const key = stu._id.toString();
      studentMap.set(key, {
        id: key,
        name: stu.name,
        admissionNo: stu.admissionNo,
        classesHeld: 0,
        classesPresent: 0,
        lastAttended: null,
      });
    });

    // 4) All sessions for this subject
    const sessions = await AttendanceSession.find({
      subject: subjectId,
    })
      .sort({ date: 1 })
      .lean();

    // 5) For each session:
    //    - increment classesHeld for all students in that session's section
    //    - increment classesPresent for those in presentStudents
    sessions.forEach((sess) => {
      const date = sess.date || sess.createdAt;
      const dateStr = date ? date.toISOString().slice(0, 10) : null;

      const section = sess.section;
      if (!section) return;

      // students in this session's section
      const sectionStudents = students.filter((s) => s.section === section);

      // everyone in section: class was held
      sectionStudents.forEach((stu) => {
        const st = studentMap.get(stu._id.toString());
        if (!st) return;
        st.classesHeld += 1;
      });

      // presentStudents: mark present + lastAttended
      (sess.presentStudents || []).forEach((sid) => {
        const st = studentMap.get(sid.toString());
        if (!st) return;
        st.classesPresent += 1;
        st.lastAttended = dateStr;
      });
    });

    // 6) Compute percentage
    const studentsArr = Array.from(studentMap.values()).map((st) => {
      const percent =
        st.classesHeld === 0
          ? 0
          : (st.classesPresent / st.classesHeld) * 100;
      return {
        ...st,
        attendancePercent: percent,
      };
    });

    res.json({
      subject: {
        id: subject._id.toString(),
        name: subject.name,
        code: subject.code,
      },
      students: studentsArr,
    });
  } catch (err) {
    console.error("Teacher subject-attendance error:", err);
    res.status(500).json({ error: "Failed to fetch subject attendance" });
  }
});

// GET /api/teacher/at-risk/:teacherId?threshold=75
// Returns list of subjects with students whose attendance < threshold
router.get("/at-risk/:teacherId", async (req, res) => {
  try {
    const { teacherId } = req.params;
    const threshold = Number(req.query.threshold) || 75;

    const teacherUser = await User.findById(teacherId);
    if (!teacherUser || teacherUser.role !== "teacher") {
      return res.status(404).json({ error: "Teacher not found" });
    }

    const subjects = await Subject.find({ teacherId: teacherUser._id });
    const subjectIds = subjects.map((s) => s._id.toString());

    // all sessions for these subjects
    const sessions = await AttendanceSession.find({
      subject: { $in: subjectIds },
    })
      .populate("subject")
      .lean();

    // build per-subject -> per-student stats with "held" counting every session
    const perSubjectStudent = {}; // subjId -> studentId -> { present, held }

    // first, get section list per subject from timetable
    const timetables = await Timetable.find({
      subject: { $in: subjectIds },
    }).lean();

    const subjectSections = {}; // subjId -> Set(sections)
    timetables.forEach((slot) => {
      const subjId = slot.subject.toString();
      if (!subjectSections[subjId]) subjectSections[subjId] = new Set();
      subjectSections[subjId].add(slot.section);
    });

    // prefetch students per section
    const allSections = new Set();
    Object.values(subjectSections).forEach((set) =>
      set.forEach((sec) => allSections.add(sec))
    );
    const sectionArr = Array.from(allSections);
    const studentsBySection = {};
    if (sectionArr.length > 0) {
      const students = await User.find({
        role: "student",
        section: { $in: sectionArr },
      }).lean();
      students.forEach((stu) => {
        if (!studentsBySection[stu.section]) studentsBySection[stu.section] = [];
        studentsBySection[stu.section].push(stu);
      });
    }

    sessions.forEach((s) => {
      if (!s.subject) return;
      const subjId = s.subject._id.toString();
      if (!perSubjectStudent[subjId]) perSubjectStudent[subjId] = {};
      const map = perSubjectStudent[subjId];

      const section = s.section;
      const sectionStudents = section ? studentsBySection[section] || [] : [];

      // count held for all students in the section (class conducted)
      sectionStudents.forEach((stu) => {
        const key = stu._id.toString();
        if (!map[key]) {
          map[key] = { present: 0, held: 0 };
        }
        map[key].held += 1;
      });

      // count present only for those who attended
      (s.presentStudents || []).forEach((sid) => {
        const key = sid.toString();
        if (!map[key]) {
          map[key] = { present: 0, held: 0 };
        }
        map[key].present += 1;
      });
    });

    const result = [];

    for (const subj of subjects) {
      const subjId = subj._id.toString();
      const map = perSubjectStudent[subjId] || {};
      const studentIds = Object.keys(map);
      if (studentIds.length === 0) continue;

      const users = await User.find({ _id: { $in: studentIds } }).lean();

      const atRiskStudents = [];

      users.forEach((u) => {
        const stats = map[u._id.toString()];
        if (!stats || stats.held === 0) return;
        const percent = (stats.present / stats.held) * 100;
        if (percent < threshold) {
          atRiskStudents.push({
            id: u._id.toString(),
            name: u.name,
            admissionNo: u.admissionNo,
            percent,
          });
        }
      });

      if (atRiskStudents.length > 0) {
        result.push({
          subjectId: subjId,
          subjectCode: subj.code,
          subjectName: subj.name,
          atRiskCount: atRiskStudents.length,
          students: atRiskStudents,
        });
      }
    }

    res.json({ subjects: result, threshold });
  } catch (err) {
    console.error("Teacher at-risk error:", err);
    res.status(500).json({ error: "Failed to fetch at-risk students" });
  }
});

/**
 * NEW: GET /api/teacher/timetable/:teacherId
 * Full timetable slots for this teacher (all days)
 */
router.get("/timetable/:teacherId", async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    const teacherUser = await User.findById(teacherId);
    if (!teacherUser || teacherUser.role !== "teacher") {
      return res.status(404).json({ error: "Teacher not found" });
    }

    const subjects = await Subject.find({ teacherId: teacherUser._id });
    const subjectIds = subjects.map((s) => s._id);

    const slots = await Timetable.find({
      subject: { $in: subjectIds },
    }).populate("subject");

    const result = slots.map((slot) => ({
      id: slot._id.toString(),
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      roomNumber: slot.roomNumber,
      section: slot.section,
      subjectCode: slot.subject.code,
      subjectName: slot.subject.name,
    }));

    res.json(result);
  } catch (err) {
    console.error("Teacher timetable error:", err);
    res.status(500).json({ error: "Failed to fetch timetable" });
  }
});

/**
 * NEW: POST /api/teacher/timetable/slot
 * Create a timetable slot with conflict detection
 * body: { teacherId, subjectCode, section, dayOfWeek, startTime, endTime, roomNumber }
 */
router.post("/timetable/slot", async (req, res) => {
  try {
    const {
      teacherId,
      subjectCode,
      section,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
    } = req.body;

    if (
      !teacherId ||
      !subjectCode ||
      !section ||
      dayOfWeek === undefined ||
      !startTime ||
      !endTime
    ) {
      return res
        .status(400)
        .json({ error: "Missing required fields for timetable slot" });
    }

    const teacherUser = await User.findById(teacherId);
    if (!teacherUser || teacherUser.role !== "teacher") {
      return res.status(404).json({ error: "Teacher not found" });
    }

    const subject = await Subject.findOne({
      code: subjectCode,
      teacherId: teacherUser._id,
    });
    if (!subject) {
      return res.status(400).json({
        error:
          "Subject not found for this teacher. Please select a valid subject.",
      });
    }

    // Conflict check: any slot in same section, same day, overlapping time
    const existing = await Timetable.find({
      section,
      dayOfWeek,
    }).populate("subject");

    const overlaps = existing.filter((slot) => {
      const s1 = startTime;
      const e1 = endTime;
      const s2 = slot.startTime;
      const e2 = slot.endTime;
      return s1 < e2 && s2 < e1;
    });

    if (overlaps.length > 0) {
      const conflictSlots = overlaps.map((slot) => ({
        id: slot._id.toString(),
        subjectCode: slot.subject.code,
        subjectName: slot.subject.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        section: slot.section,
        roomNumber: slot.roomNumber,
      }));
      return res.status(409).json({
        error:
          "Slot conflict: another class is already scheduled for this section in that time.",
        conflicts: conflictSlots,
      });
    }

    const newSlot = await Timetable.create({
      subject: subject._id,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
      section,
    });

    // Immediately notify all students in this section about the new/updated class
    const students = await User.find({
      role: "student",
      section: section,
    }).lean();

    if (students.length > 0) {
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayLabel = dayNames[dayOfWeek] || `Day ${dayOfWeek}`;

      const title = "New class scheduled";
      const message = `A class for ${subject.name} (${subject.code}) has been scheduled on ${dayLabel} from ${startTime} to ${endTime} in ${
        roomNumber || "Classroom"
      }.`;

      const bulkNotifications = students.map((stu) => ({
        userId: stu._id,
        role: "student",
        type: "class_reminder",
        title,
        message,
        isRead: false,
      }));

      await Notification.insertMany(bulkNotifications);
    }

    res.json({
      id: newSlot._id.toString(),
      subjectCode: subject.code,
      subjectName: subject.name,
      dayOfWeek,
      startTime,
      endTime,
      roomNumber,
      section,
    });
  } catch (err) {
    console.error("Create timetable slot error", err);
    res.status(500).json({ error: "Failed to create timetable slot" });
  }
});

/**
 * NEW: GET /api/teacher/notifications/:teacherId
 * Fetch latest notifications for a teacher
 */
router.get("/notifications/:teacherId", async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    const notifications = await Notification.find({
      userId: teacherId,
      role: "teacher",
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
    console.error("Teacher notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/**
 * NEW: PATCH /api/teacher/notifications/mark-read
 * body: { notificationIds: [...] }
 */
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
    console.error("Teacher mark notifications read error:", err);
    res.status(500).json({ error: "Failed to mark notifications read" });
  }
});

module.exports = router;
