const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/user');
const Club = require('./models/club');
const Admin = require('./models/admin');
const Event = require('./models/event');
const Registration = require('./models/registration');
const Discussion = require('./models/discussion');
const Feedback = require('./models/feedback');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/felicity';

// Sample data arrays
const firstNames = ['Rahul', 'Priya', 'Arjun', 'Ananya', 'Rohan', 'Kavya', 'Aditya', 'Sneha', 'Vikram', 'Ishita', 'Karan', 'Diya', 'Siddharth', 'Pooja', 'Harsh'];
const lastNames = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Reddy', 'Gupta', 'Mehta', 'Verma', 'Iyer', 'Nair', 'Desai', 'Joshi', 'Rao', 'Agarwal', 'Pillai'];
const colleges = ['IIIT Hyderabad', 'IIT Delhi', 'IIT Bombay', 'NIT Trichy', 'BITS Pilani', 'VIT Vellore', 'Manipal Institute', 'SRM University', 'Delhi University', 'Mumbai University'];

const clubNames = ['Music Club', 'Dance Society', 'Tech Club', 'Photography Club', 'Literature Society', 'Gaming Club', 'Art Society', 'Sports Committee'];
const clubCategories = ['music', 'dance', 'technology', 'photography', 'literature', 'gaming', 'art', 'sports'];
const clubDescriptions = [
  'Promoting musical talent and organizing concerts across campus',
  'Bringing together dancers of all styles and levels',
  'Exploring cutting-edge technology and hosting hackathons',
  'Capturing moments and teaching photography skills',
  'Celebrating literature through book clubs and writing workshops',
  'Competitive gaming and esports tournaments',
  'Fostering creativity through various art forms',
  'Organizing sports events and promoting fitness'
];

const eventTypes = ['normal', 'merchandise'];
const eligibilities = ['all', 'iiitans', 'external'];
const eventStatuses = ['published', 'ongoing', 'completed'];

const discussionMessages = [
  'Really excited for this event! When will registration open?',
  'Can we get more details about the schedule?',
  'Is there any prerequisite for participation?',
  'Looking forward to this! Count me in.',
  'Will there be certificates provided?',
  'What about accommodation for outstation participants?',
  'Is team formation allowed?',
  'Can we get the venue details?'
];

const feedbackComments = [
  'Amazing event! Well organized and thoroughly enjoyed it.',
  'Good effort but could improve on time management.',
  'Excellent speakers and great content.',
  'Venue was a bit small for the crowd.',
  'Food arrangements were top-notch!',
  'Would love to see more such events.',
  'Technical issues at the start but recovered well.',
  'One of the best events I have attended!'
];

// Helper functions
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomDate = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const randomPastDate = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
const randomFutureDate = (daysAhead) => new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

async function clearDatabase() {
  console.log('🗑️  Clearing existing data...');
  await User.deleteMany({});
  await Club.deleteMany({});
  await Admin.deleteMany({});
  await Event.deleteMany({});
  await Registration.deleteMany({});
  await Discussion.deleteMany({});
  await Feedback.deleteMany({});
  console.log('✅ Database cleared');
}

async function createAdmin() {
  console.log('👤 Creating admin...');
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await Admin.create({
    firstName: 'System',
    lastName: 'Admin',
    email: 'admin@felicity.com',
    password: hashedPassword
  });
  console.log('✅ Admin created:', admin.email);
  return admin;
}

async function createUsers(count = 15) {
  console.log(`👥 Creating ${count} users...`);
  const users = [];

  for (let i = 0; i < count; i++) {
    const isIIIT = i < 10; // First 10 are IIIT students
    const email = isIIIT
      ? `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@students.iiit.ac.in`
      : `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@gmail.com`;

    const hashedPassword = await bcrypt.hash('user123', 10);

    const user = await User.create({
      firstName: firstNames[i % firstNames.length],
      lastName: lastNames[i % lastNames.length],
      email: email,
      participantType: isIIIT ? 'iiitan' : 'external',
      collegeName: isIIIT ? 'IIIT Hyderabad' : randomItem(colleges),
      contactNumber: `+91${randomInt(7000000000, 9999999999)}`,
      password: hashedPassword,
      interests: [randomItem(clubCategories), randomItem(clubCategories)],
      followedClubs: []
    });
    users.push(user);
  }

  console.log(`✅ Created ${users.length} users`);
  return users;
}

async function createClubs(count = 8) {
  console.log(`🏢 Creating ${count} clubs...`);
  const clubs = [];

  for (let i = 0; i < count; i++) {
    const hashedPassword = await bcrypt.hash('club123', 10);

    const club = await Club.create({
      name: clubNames[i],
      email: `${clubNames[i].toLowerCase().replace(/\s+/g, '')}@felicity.com`,
      password: hashedPassword,
      category: clubCategories[i],
      description: clubDescriptions[i],
      contactEmail: `contact.${clubNames[i].toLowerCase().replace(/\s+/g, '')}@felicity.com`,
      phoneNumber: `+91${randomInt(8000000000, 9999999999)}`,
      website: `https://${clubNames[i].toLowerCase().replace(/\s+/g, '')}.felicity.com`,
      discordWebhook: i < 3 ? `https://discord.com/api/webhooks/123456789/sample-webhook-${i}` : null,
      establishedDate: randomPastDate(randomInt(365, 1825)),
      socialLinks: {
        instagram: `https://instagram.com/${clubNames[i].toLowerCase().replace(/\s+/g, '')}`,
        twitter: `https://twitter.com/${clubNames[i].toLowerCase().replace(/\s+/g, '')}`,
        facebook: null,
        linkedin: null
      }
    });
    clubs.push(club);
  }

  console.log(`✅ Created ${clubs.length} clubs`);
  return clubs;
}

async function createEvents(clubs, users) {
  console.log('🎉 Creating events...');
  const events = [];

  for (const club of clubs) {
    // Create 2-3 events per club
    const eventCount = randomInt(2, 3);

    for (let i = 0; i < eventCount; i++) {
      const eventType = randomItem(eventTypes);
      const regDeadline = randomFutureDate(randomInt(5, 15));
      const startDate = new Date(regDeadline.getTime() + 2 * 24 * 60 * 60 * 1000);
      const endDate = new Date(startDate.getTime() + randomInt(1, 3) * 24 * 60 * 60 * 1000);

      let customForm = { fields: [], locked: false };
      let merchandiseDetails = null;

      if (eventType === 'normal') {
        // Create custom form with various field types
        customForm = {
          fields: [
            {
              fieldId: `field_${Date.now()}_1`,
              label: 'Why do you want to participate?',
              type: 'textarea',
              required: true,
              options: []
            },
            {
              fieldId: `field_${Date.now()}_2`,
              label: 'Experience Level',
              type: 'dropdown',
              required: true,
              options: ['Beginner', 'Intermediate', 'Advanced', 'Expert']
            },
            {
              fieldId: `field_${Date.now()}_3`,
              label: 'Email Address',
              type: 'email',
              required: true,
              options: []
            },
            {
              fieldId: `field_${Date.now()}_4`,
              label: 'Dietary Preferences',
              type: 'checkbox',
              required: false,
              options: ['Vegetarian', 'Vegan', 'Non-Vegetarian', 'Gluten-Free', 'No Preference']
            },
            {
              fieldId: `field_${Date.now()}_5`,
              label: 'Upload Resume (URL)',
              type: 'file',
              required: false,
              options: []
            },
            {
              fieldId: `field_${Date.now()}_6`,
              label: 'Phone Number',
              type: 'number',
              required: true,
              options: []
            }
          ],
          locked: false
        };
      } else {
        // Merchandise event
        merchandiseDetails = {
          variants: [
            {
              variantId: `var_${Date.now()}_1`,
              size: 'S',
              color: 'Black',
              stockQuantity: randomInt(20, 50),
              price: randomInt(299, 599)
            },
            {
              variantId: `var_${Date.now()}_2`,
              size: 'M',
              color: 'Black',
              stockQuantity: randomInt(20, 50),
              price: randomInt(299, 599)
            },
            {
              variantId: `var_${Date.now()}_3`,
              size: 'L',
              color: 'Blue',
              stockQuantity: randomInt(20, 50),
              price: randomInt(299, 599)
            },
            {
              variantId: `var_${Date.now()}_4`,
              size: 'XL',
              color: 'Blue',
              stockQuantity: randomInt(20, 50),
              price: randomInt(299, 599)
            }
          ],
          purchaseLimit: randomInt(2, 5)
        };
      }

      const event = await Event.create({
        name: `${club.name} ${eventType === 'normal' ? 'Workshop' : 'Merchandise'} ${i + 1}`,
        description: `Join us for an amazing ${eventType} event organized by ${club.name}. This is a great opportunity to learn, network, and have fun! We have exciting activities planned including interactive sessions, hands-on workshops, and much more. Don't miss out on this fantastic experience!`,
        organizerId: club._id,
        eventType: eventType,
        eligibility: randomItem(eligibilities),
        registrationDeadline: regDeadline,
        eventStartDate: startDate,
        eventEndDate: endDate,
        registrationLimit: randomInt(50, 200),
        registrationFee: eventType === 'merchandise' ? 0 : randomInt(0, 500),
        tags: [club.category, eventType, 'workshop', 'fun'],
        customForm: customForm,
        merchandiseDetails: merchandiseDetails,
        status: randomItem(eventStatuses),
        totalRegistrations: 0
      });

      events.push(event);
    }
  }

  console.log(`✅ Created ${events.length} events`);
  return events;
}

async function createRegistrations(events, users) {
  console.log('📝 Creating registrations...');
  const registrations = [];

  for (const event of events) {
    // Register 30-70% of users for each event
    const participantCount = Math.floor(users.length * (0.3 + Math.random() * 0.4));
    const shuffledUsers = users.sort(() => 0.5 - Math.random()).slice(0, participantCount);

    for (const user of shuffledUsers) {
      let formData = {};
      let merchandiseSelection = null;

      if (event.eventType === 'normal' && event.customForm.fields) {
        // Convert formData array to Map object (mocking the map behavior with object)
        const formDataArray = event.customForm.fields.map(field => {
          let value = '';
          switch (field.type) {
            case 'text':
            case 'textarea':
              value = `This is my response for ${field.label}`;
              break;
            case 'email':
              value = `user${randomInt(1, 999)}@example.com`;
              break;
            case 'number':
              value = randomInt(6000000000, 9999999999).toString();
              break;
            case 'dropdown':
              value = randomItem(field.options);
              break;
            case 'checkbox':
              const selectedCount = randomInt(1, Math.min(3, field.options.length));
              value = field.options.sort(() => 0.5 - Math.random()).slice(0, selectedCount);
              break;
            case 'file':
              value = `https://example.com/uploads/file_${user._id}.pdf`;
              break;
            default:
              value = 'Sample response';
          }
          return {
            fieldId: field.fieldId,
            value: value
          };
        });

        // Convert to Map format for schema
        formData = {};
        formDataArray.forEach(item => {
          formData[item.fieldId] = item.value;
        });
      } else if (event.eventType === 'merchandise' && event.merchandiseDetails) {
        const variant = randomItem(event.merchandiseDetails.variants);
        const quantity = randomInt(1, Math.min(2, event.merchandiseDetails.purchaseLimit));
        merchandiseSelection = {
          variantId: variant.variantId,
          quantity: quantity
        };
      }

      // Determine payment status logic
      let paymentStatus = 'completed';
      let paymentApprovalStatus = 'not_required';
      let paymentProofImage = null;
      let paymentRejectionReason = null;

      if (event.eventType === 'merchandise' && event.registrationFee === 0) { // Using 0 fee as flag for merchandise event logic in seed
        // For merchandise, we simulate the payment approval flow
        const rand = Math.random();
        if (rand < 0.2) {
          // Pending
          paymentStatus = 'pending';
          paymentApprovalStatus = 'pending';
          paymentProofImage = '/uploads/sample_receipt.jpg';
        } else if (rand < 0.3) {
          // Rejected
          paymentStatus = 'pending';
          paymentApprovalStatus = 'rejected';
          paymentProofImage = '/uploads/sample_receipt.jpg';
          paymentRejectionReason = 'Invalid screenshot';
        } else if (rand < 0.9) {
          // Approved
          paymentStatus = 'completed';
          paymentApprovalStatus = 'approved';
          paymentProofImage = '/uploads/sample_receipt.jpg';
        } else {
          // Not uploaded yet
          paymentStatus = 'pending';
          paymentApprovalStatus = 'pending'; // or 'not_required' if we treat it as initial state, but typically simulated as pending upload
        }
      } else if (event.registrationFee > 0) {
        paymentStatus = randomItem(['completed', 'pending']);
      }

      // Determine attendance status
      let attendanceStatus = 'not_checked';
      let manualOverride = false;
      let overrideReason = null;
      let scanHistory = [];
      let status = 'registered';

      if (event.status === 'completed' || event.status === 'ongoing') {
        const rand = Math.random();
        if (rand < 0.6) { // 60% attendance
          attendanceStatus = 'present';
          status = 'attended';
          scanHistory.push({
            timestamp: new Date(event.eventStartDate.getTime() + randomInt(0, 3600000)), // within 1 hour of start
            action: 'scanned',
            performedBy: event.organizerId
          });

          if (Math.random() < 0.1) {
            // Simulate duplicate scan
            scanHistory.push({
              timestamp: new Date(event.eventStartDate.getTime() + randomInt(3600000, 7200000)),
              action: 'duplicate_rejected',
              performedBy: event.organizerId
            });
          }
        } else if (rand < 0.7) { // 10% Manual override present
          attendanceStatus = 'present';
          status = 'attended';
          manualOverride = true;
          overrideReason = 'Scanner malfunction';
          scanHistory.push({
            timestamp: new Date(event.eventStartDate.getTime() + randomInt(0, 3600000)),
            action: 'manual_present',
            performedBy: event.organizerId,
            notes: 'Scanner malfunction'
          });
        } else {
          // Absent or not checked
          attendanceStatus = Math.random() > 0.5 ? 'absent' : 'not_checked';
        }
      }

      const registration = await Registration.create({
        userId: user._id,
        eventId: event._id,
        registrationDate: randomPastDate(randomInt(1, 30)),
        status: status,
        paymentStatus: paymentStatus,
        paymentApprovalStatus: paymentApprovalStatus,
        paymentProofImage: paymentProofImage,
        paymentRejectionReason: paymentRejectionReason,

        ticketId: `TICK-${Date.now()}-${randomInt(1000, 9999)}`,
        teamName: Math.random() > 0.7 ? `Team ${randomItem(['Alpha', 'Beta', 'Gamma', 'Delta', 'Phoenix'])}` : null,
        formData: formData,
        merchandiseSelection: merchandiseSelection,

        attendanceStatus: attendanceStatus,
        attendanceTimestamp: attendanceStatus === 'present' ? scanHistory[0]?.timestamp : null,
        scanHistory: scanHistory,
        manualOverride: manualOverride,
        overrideReason: overrideReason
      });

      registrations.push(registration);

      // Update event registration count & revenue & attendance
      let revenueInc = 0;
      if (paymentStatus === 'completed' && event.registrationFee > 0) {
        revenueInc += event.registrationFee;
      }
      if (merchandiseSelection && paymentApprovalStatus === 'approved') {
        // Approx calculation for seed
        const variant = event.merchandiseDetails.variants.find(v => v.variantId === merchandiseSelection.variantId);
        if (variant) revenueInc += variant.price * merchandiseSelection.quantity;
      }

      await Event.findByIdAndUpdate(event._id, {
        $inc: {
          totalRegistrations: 1,
          totalRevenue: revenueInc,
          totalAttendance: status === 'attended' ? 1 : 0
        }
      });
    }
  }

  console.log(`✅ Created ${registrations.length} registrations`);
  return registrations;
}

async function createDiscussions(events, users, clubs) {
  console.log('💬 Creating discussions...');
  const discussions = [];

  for (const event of events) {
    const messageCount = randomInt(3, 8);

    for (let i = 0; i < messageCount; i++) {
      const isClubPost = Math.random() > 0.7;
      const author = isClubPost ? clubs.find(c => c._id.equals(event.organizerId)) : randomItem(users);

      const discussion = await Discussion.create({
        eventId: event._id,
        authorId: author._id,
        authorType: isClubPost ? 'Club' : 'User',
        message: randomItem(discussionMessages),
        isAnnouncement: isClubPost && Math.random() > 0.6,
        isPinned: Math.random() > 0.8,
        parentMessageId: null,
        reactions: users.slice(0, randomInt(0, 5)).map(u => ({
          userId: u._id,
          emoji: randomItem(['👍', '❤️', '😊', '🎉', '👏'])
        }))
      });

      discussions.push(discussion);

      // Add some replies
      if (Math.random() > 0.6) {
        const reply = await Discussion.create({
          eventId: event._id,
          authorId: randomItem(users)._id,
          authorType: 'User',
          message: 'Thanks for the info! Looking forward to it.',
          isAnnouncement: false,
          isPinned: false,
          parentMessageId: discussion._id,
          reactions: []
        });
        discussions.push(reply);
      }
    }
  }

  console.log(`✅ Created ${discussions.length} discussion messages`);
  return discussions;
}

async function createFeedback(events, users) {
  console.log('⭐ Creating feedback...');
  const feedbackList = [];

  // Only create feedback for completed events
  const completedEvents = events.filter(e => e.status === 'completed');

  for (const event of completedEvents) {
    // Get registrations for this event where status is 'attended'
    const attendedRegs = await Registration.find({
      eventId: event._id,
      status: 'attended'
    });

    for (const reg of attendedRegs) {
      // 70% chance to submit feedback
      if (Math.random() < 0.7) {
        const rating = randomInt(1, 5);
        const feedback = await Feedback.create({
          eventId: event._id,
          userId: reg.userId,
          rating: rating,
          comment: randomItem(feedbackComments),
          isAnonymous: true
        });
        feedbackList.push(feedback);
      }
    }
  }

  console.log(`✅ Created ${feedbackList.length} feedback entries`);
  return feedbackList;
}

async function updateUserFollowers(users, clubs) {
  console.log('🔗 Updating user followers...');

  for (const user of users) {
    const followCount = randomInt(2, 5);
    const followedClubs = clubs.sort(() => 0.5 - Math.random()).slice(0, followCount);

    for (const club of followedClubs) {
      // followedClubs is an array of ObjectIds, not objects
      user.followedClubs.push(club._id.toString());

      // Update club's follower count
      await Club.findByIdAndUpdate(club._id, {
        $inc: { followerCount: 1 }
      });
    }

    await user.save();
  }

  console.log('✅ Updated user followers');
}

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...\n');

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Clear existing data
    await clearDatabase();
    console.log('');

    // Create data in order
    const admin = await createAdmin();
    console.log('');

    const users = await createUsers(15);
    console.log('');

    const clubs = await createClubs(8);
    console.log('');

    const events = await createEvents(clubs, users);
    console.log('');

    const registrations = await createRegistrations(events, users);
    console.log('');

    const discussions = await createDiscussions(events, users, clubs);
    console.log('');

    const feedbackList = await createFeedback(events, users);
    console.log('');

    await updateUserFollowers(users, clubs);
    console.log('');

    // Print summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SEEDING SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Admin: 1`);
    console.log(`✅ Users: ${users.length}`);
    console.log(`✅ Clubs: ${clubs.length}`);
    console.log(`✅ Events: ${events.length}`);
    console.log(`✅ Registrations: ${registrations.length}`);
    console.log(`✅ Discussions: ${discussions.length}`);
    console.log(`✅ Feedback: ${feedbackList.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🔐 LOGIN CREDENTIALS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin:');
    console.log('  Email: admin@felicity.com');
    console.log('  Password: admin123\n');
    console.log('Sample Club:');
    console.log(`  Email: ${clubs[0].email}`);
    console.log('  Password: club123\n');
    console.log('Sample User:');
    console.log(`  Email: ${users[0].email}`);
    console.log('  Password: user123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🎉 Database seeding completed successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

// Run the seed function
seedDatabase();
