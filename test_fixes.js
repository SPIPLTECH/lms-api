const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API_URL = 'http://localhost:5000';

async function runTests() {
  console.log('--- STARTING VERIFICATION TESTS ---\n');
  let testCount = 0;
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    testCount++;
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passCount++;
    } else {
      console.log(`❌ FAIL: ${message}`);
      failCount++;
    }
  }

  try {
    // SETUP DATA
    console.log('--- DB SETUP ---');
    await prisma.user.deleteMany({ where: { email: { contains: 'test' } } });
    await prisma.course.deleteMany({ where: { title: 'Test Course' } });

    // 1. AUTH VALIDATION & REGISTRATION ERROR HANDLING
    console.log('\n--- TEST 1: Auth Validation & Registration ---');
    try {
      await axios.post(`${API_URL}/auth/register`, {
        name: 'T', // Too short
        email: 'invalid-email',
        password: '123' // Too short
      });
      assert(false, 'Validation should block invalid data');
    } catch (e) {
      assert(e.response?.status === 400, `Validation returns 400 (got ${e.response?.status})`);
      assert(e.response?.data?.message, `Validation returns message: ${e.response?.data?.message}`);
    }

    const validUser = {
      name: 'Test Student',
      email: 'test_student@example.com',
      password: 'password123'
    };

    // Register valid user
    await axios.post(`${API_URL}/auth/register`, validUser);

    // Duplicate email
    try {
      await axios.post(`${API_URL}/auth/register`, validUser);
      assert(false, 'Duplicate email should be blocked');
    } catch (e) {
      assert(e.response?.status === 409, `Duplicate email returns 409 Conflict (got ${e.response?.status})`);
      assert(e.response?.data?.message === 'Email already registered.', 'Duplicate email message is correct');
    }

    // 2. USER STATUS ENFORCEMENT
    console.log('\n--- TEST 2: User Status Enforcement ---');
    // Verify email and suspend user via DB
    await prisma.user.update({
      where: { email: validUser.email },
      data: { isVerified: true, status: 'SUSPENDED' }
    });

    try {
      await axios.post(`${API_URL}/auth/login`, {
        email: validUser.email,
        password: validUser.password
      });
      assert(false, 'Suspended user should not login');
    } catch (e) {
      assert(e.response?.status === 403, `Suspended user login returns 403 (got ${e.response?.status})`);
      assert(e.response?.data?.message.includes('suspended'), 'Login returns suspended message');
    }

    // 3. GUEST BROWSING & QUIZ ANSWER EXPOSURE
    console.log('\n--- TEST 3: Guest Browsing & Quiz Answers ---');
    
    // Register Instructor via API so password gets hashed
    await axios.post(`${API_URL}/auth/register`, {
      name: 'Test Instructor',
      email: 'test_instructor@example.com',
      password: 'password123'
    });

    // Make user INSTRUCTOR and VERIFIED and ACTIVE in DB
    const instructor = await prisma.user.update({
      where: { email: 'test_instructor@example.com' },
      data: { role: 'INSTRUCTOR', isVerified: true, status: 'ACTIVE' }
    });

    const course = await prisma.course.create({
      data: {
        title: 'Test Course',
        description: 'Test Course Description',
        category: 'Test',
        level: 'Beginner',
        status: 'PUBLISHED',
        creatorId: instructor.id,
      }
    });

    const quiz = await prisma.quiz.create({
      data: {
        title: 'Test Quiz',
        courseId: course.id,
        isPublished: true,
        passingScore: 50,
      }
    });

    await prisma.question.create({
      data: {
        quizId: quiz.id,
        title: 'Q1',
        question: 'What is 2+2?',
        options: ['2', '3', '4', '5'],
        correctAnswer: '4',
        explanation: 'Math',
      }
    });

    // Login as instructor to get token
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'test_instructor@example.com',
      password: 'password123'
    });
    const instructorToken = loginRes.data.data.accessToken;

    // Test Guest Browsing GET /courses
    const coursesRes = await axios.get(`${API_URL}/courses`);
    assert(coursesRes.status === 200, 'Guest can GET /courses');
    
    // Test Guest GET /courses/:id (Quiz Answer Exposure)
    const courseGuestRes = await axios.get(`${API_URL}/courses/${course.id}`);
    assert(courseGuestRes.status === 200, 'Guest can GET /courses/:id');
    
    const guestQuizQuestions = courseGuestRes.data.data.quizzes[0].questions;
    assert(guestQuizQuestions.length > 0, 'Quiz questions are loaded');
    assert(guestQuizQuestions[0].correctAnswer === undefined, 'Guest cannot see correctAnswer in course details');
    assert(guestQuizQuestions[0].explanation === undefined, 'Guest cannot see explanation in course details');

    // Test Instructor GET /courses/:id
    const courseInstructorRes = await axios.get(`${API_URL}/courses/${course.id}`, {
      headers: { Authorization: `Bearer ${instructorToken}` }
    });
    const instQuizQuestions = courseInstructorRes.data.data.quizzes[0].questions;
    assert(instQuizQuestions[0].correctAnswer === '4', 'Instructor CAN see correctAnswer in course details');

    // Test Guest POST /courses
    try {
      await axios.post(`${API_URL}/courses`, { title: 'New' });
      assert(false, 'Guest should not POST /courses');
    } catch (e) {
      assert(e.response?.status === 401, `Guest POST returns 401 (got ${e.response?.status})`);
    }

  } catch (error) {
    console.error('Unhandled Test Error:', error.response?.data || error.message || error);
  } finally {
    // CLEANUP
    await prisma.user.deleteMany({ where: { email: { contains: 'test' } } });
    await prisma.course.deleteMany({ where: { title: 'Test Course' } });
    await prisma.$disconnect();

    console.log(`\n--- SUMMARY: ${passCount}/${testCount} PASSED ---`);
  }
}

runTests();
