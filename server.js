const express = require('express')
const fs = require('fs');
const environmentVars = require('dotenv').config();
const https = require('https');
const bodyParser = require('body-parser');
const flash = require('connect-flash');
const session = require('express-session');
const mysql = require('mysql');
const cors = require('cors');

let global_phrases = [];

// MySQL setup
let connection_details = {
    host: '35.240.182.121',
    user: 'root',
    password: '',
    database: 'codegrind'
}

// Nodemailer
const nodemailer = require('nodemailer');
let transporter = nodemailer.createTransport({
 service: 'gmail',
 auth: {
        user: 'meetinghubcodegrind@gmail.com',
        pass: 'meetinghub123'
    }
});

const conn = mysql.createConnection(connection_details);
conn.connect();

// DialogFlow
const dialogflow = require('dialogflow').v2beta1;
const uuid = require('uuid');

// Google Cloud setup
const speechApi = require('@google-cloud/speech').v1p1beta1;
const speechClient = new speechApi.SpeechClient();

// Express setup
const app = express();
const httpsOptions = {
    key: fs.readFileSync('./security/cert.key'),
    cert: fs.readFileSync('./security/cert.pem')
}
const server = https.createServer(httpsOptions, app);

// cors
var whitelist = [
    'https://localhost:4000',
    'https://127.0.0.1:4000',
];
var corsOptions = {
    origin: function(origin, callback){
        var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
        callback(null, originIsWhitelisted);
    },
    credentials: true
};
app.use(cors(corsOptions));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(flash());
app.use(session({ cookie: { maxAge: 300000 }, 
    secret: 't0P_sEcrt',
    resave: false, 
    saveUninitialized: false}));

// Socket IO setup
const io = require('socket.io')(server);

// Static folder 'public' -> 'assets'
app.use('/assets', express.static(__dirname + '/public'));

// Set view engine to ejs default is pug
app.set('view engine', 'pug');

/*--------- Views ---------*/
app.options('*', cors());

app.get('/', (req, res)=>{
    if(!req.session.user){
        res.redirect('/login');
        return;
    }

    // Execute on successfully fetching list of meetings
    function success(upcoming_meetings_, past_meetings_){
        res.render('index', {user: req.session.user, 
            upcoming_meetings: upcoming_meetings_, 
            past_meetings: past_meetings_
        });
    }
    
    getMeetingList(req.session.user, success);
});

app.get('/login', (req, res)=>{
    if(req.session.user){
        res.redirect('/');
        return;
    }
    res.render('login', {message: req.flash('error')});
});

app.post('/login', (req, res)=>{
    let psid = req.body.psid;
    let password = req.body.password;

    if(!psid){
        console.log('Psid cannot be blank');
        req.flash('error','Psid cannot be blank');
        res.redirect('/login');
        return;
    }
    if(!password){
        console.log('Password cannot be blank');
        req.flash('error','Password cannot be blank');
        res.redirect('/login');
        return;
    }

    // On login success
    function success(){
        let sql = 'SELECT id, name FROM user WHERE psid=?';
        conn.query(sql, [psid], (error, rows, fields)=>{
            console.log(rows);
            req.session.user = rows[0].id;
            req.session.name_ = rows[0].name;
            return res.redirect('/');
            return;
        });
    }
    // On login failure    
    function failure(){
        req.flash('error', 'Username/password do not match');
        res.redirect('/login');
        return;
    }

    doLoginAction(psid, password, success, failure);
});

app.get('/logout', (req, res)=>{
    req.session.destroy();
    res.redirect('/login');
    return;
});

app.post('/meeting/new/:id', (req, res)=>{
    if(!req.session.user){
        res.redirect('/login');
        return;
    }

    console.log(req.body);

    let subject = req.body.subject;
    let location = req.body.location;
    let datetime = req.body.datetime;
    let status = req.body.status;
    let owner = req.session.name_;
    let agenda = req.body.agenda.split(',');
    let id = req.params['id'];

    global_phrases.concat(owner.split(' '));

    console.log('Getting Participants...');
    getParticipants(id, success);

    function success(data){
        console.log(data);
        for(p of data){
            global_phrases.concat(p.name.split(' '));
        }

        agenda.forEach((item)=>{
            global_phrases.concat(item.split(' '));
        });

        res.render('meeting', {subject: subject,
            location: location,
            datetime: datetime,
            owner: owner,
            agenda: agenda,
            id: id,
            status: status,
            participants: data    
        });
    }
});

app.post('/assistant', (req, res)=>{
    let queryText = req.body.query;
    console.log('Assistant required for query ', queryText);
    dialog(res, queryText, 'codegrind-223715');
});

app.post('/meeting/end', (req, res)=>{
    let notes = req.body.notes;
    let actionItems = req.body.actionItems;
    let meeting_id = req.body.meeting_id;
    let transcript = req.body.transcript;
    let text = '<b>Notes:</b><br>' + notes + '<br><b>Action Items:</b><br>' + actionItems;
    saveMeeting(meeting_id, notes, actionItems, transcript, success);
    
    function success(){
        sendMail('anjum.salman@outlook.com', text);
        res.json({"msg": "Mail sent"});
    }
});

app.get('/meeting/end/:id', (req, res)=>{
    let id = req.params['id'];

    function success(data){
        res.render('end', {actionItems: data});
    }
    getActionItems(id, success);
});

app.post('/meeting/create', (req, res)=>{
    console.log('Adding new meeting...')
    let subject = req.body.subject;
    let location = req.body.location;
    let datetime = req.body.datetime;
    let owner = req.body.owner;
    let agenda = req.body.agenda;
    let participants = req.body.participants;

    // Success function
    function success(){
        res.json({'msg': 'Added new meeting'});
    }

    createMeeting(subject, location, datetime, owner, agenda, participants, success);
});

/*--------- Socket IO ---------*/
io.on('connection', (socket)=>{
    console.log('Socket connection made');

    let recognitionStream = null;

    socket.on('speechInit', (data)=>{
        console.log('Initializing recognition engine');
        startRecognitionStream(this, data);
    });

    socket.on('speechData', (data)=>{
        if(recognitionStream !== null){
            recognitionStream.write(data);
        }
    });

    socket.on('speechEnd', (data)=>{
        stopRecognitionStream();
    });

    function startRecognitionStream(socket, data){
        let recognitionMetadata = {
            interactionType: 'DISCUSSION',
            microphoneDistance: 'NEARFIELD',
            recordingDeviceType: 'PC',
        };
      
        let speechConfig = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                languageCode: 'en-IN',
                profanityFilter: false,
                enableSpeakerDiarization: true,
                metadata: recognitionMetadata,
                speechContexts: [{
                    phrases: global_phrases
                }]
            },
            interimResults: false
        }

        recognitionStream = speechClient.streamingRecognize(speechConfig)
        .on('error', console.error)
        .on('data', (data)=>{
            console.log(data);
            io.emit('textData', data);

            if(data.results[0] && data.results[0].isFinal) {
                stopRecognitionStream();
                startRecognitionStream(socket);
            }
        });
    }

    function stopRecognitionStream(){
        if(recognitionStream){
            recognitionStream.end();
        }

        recognitionStream = null;
    }
});

server.listen(4000);

/*--------- Database Queries ---------*/
function doLoginAction(psid, password, success, failure){
    let sql = 'SELECT * FROM user WHERE psid=? AND password=?';
    conn.query(sql, [psid, password], (error, rows, fields)=>{
        if(error)
            throw error;
        
        if(rows.length>0)
            success();
        else
            failure();
    });
}

// Create meeting
function createMeeting(subject, location, datetime, owner, agenda, participants, success){
    let sql = "INSERT INTO meeting(subject, location, datetime_, status, owner, agenda) VALUES(?,?,?,'Not started',(SELECT id FROM user WHERE email=?),?)";
    let params = [subject, location, datetime, owner, agenda];
    conn.query(sql, params, (err, results, fields)=>{
        if(err)
            console.log('Error:' + err.message);
        
        // Add each participant to the table
        let sql =""
        for(p of participants){
            sql+="CALL add_participant('"+ p + "'," + results.insertId + ");";
        }
        conn.query(sql, (err, results, fields)=>{
            if(err)
                console.log('Error while adding participants ', err.message);

            success();
        });
    });
}

// Starting meeting
function startMeeting(meeting_id){
    let sql = "UPDATE TABLE meeting SET status='Y' WHERE id=" + meeting_id;
    conn.query(sql);
}

// Get meeting list
function getMeetingList(owner, success){
    // First get upcoming meetings
    let sql = "SELECT * FROM meeting WHERE owner=? AND status='Not started'";
    conn.query(sql, [owner], (error, rows, fields)=>{
        let upcoming_meetings = []
        if(rows.length>0){
            upcoming_meetings = rows;
        }
        // Then get past meetings
        let sql = "SELECT * FROM meeting WHERE owner=? AND status='Completed'";
        conn.query(sql, [owner], (error, rows, fields)=>{
            let past_meetings = []
            if(rows.length>0){
                past_meetings = rows;
            }

            success(upcoming_meetings, past_meetings);
        });

    });
}

// Get participant list
function getParticipants(meeting_id, success){
    console.log('Meeting id = ', meeting_id);
    let sql = 'select name, psid, email from user, participant where participant.meeting_id = ?'
    + ' and participant.user_id = user.id';
    conn.query(sql, [meeting_id], (err, rows, fields)=>{
        if(rows.length>0)
            success(rows);
    });
}

function saveMeeting(meeting_id, notes, actionItems, transcript, success){
    let sql = "UPDATE meeting SET status='Completed', notes=?, action_items=?, transcript=? WHERE id=?";
    conn.query(sql, [notes,actionItems,transcript,meeting_id], (err, rows, fields)=>{
        if(err)
            console.log('Error while updating table', err.message);
        success();
    })
}

function getActionItems(meeting_id, success){
    let sql = "SELECT action_items FROM meeting WHERE id=?";
    conn.query(sql, [meeting_id], (err, rows, fields)=>{
        if(err)
            console.log('Error while getting action items');
        console.log(rows);
        success(rows[0].action_items.split('<br>'));
    })
}

/*------- DialogFlow --------*/
// Dialog Responses
async function dialog(res, textData, projectId){
    // A unique identifier for the given session
    const sessionId = uuid.v4();

    // Create a new session
    const sessionClient = new dialogflow.SessionsClient();
    const sessionPath = sessionClient.sessionPath(projectId, sessionId);

    // The text query request.
    console.log('Your query is ', textData);
    const request = {
        session: sessionPath,
        queryInput: {
            text: {
                text: textData,
                languageCode: 'en-IN',
            },
        },
        output_audio_config:{
            audio_encoding: 'OUTPUT_AUDIO_ENCODING_LINEAR_16'
        }
    };

    // Send request and log result
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0];
    console.log(responses[0]);
    res.json({'response': result});
}

// Send mail
function sendMail(to_, content_){
    const mailOptions = {
      from: 'meetinghubcodegrind@gnail.com', // sender address
      to: to_, // list of receivers
      subject: 'Meeting Hub', // Subject line
      html: content_// plain text body
    };

    transporter.sendMail(mailOptions, function (err, info) {
       if(err)
         console.log(err);
       else
         console.log(info);
    });
}