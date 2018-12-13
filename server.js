const express = require('express')
const fs = require('fs');
const environmentVars = require('dotenv').config();
const http = require('http');
const bodyParser = require('body-parser');
const flash = require('connect-flash');
const session = require('express-session');
const mysql = require('mysql');

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
const server = http.createServer(app);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(flash());
app.use(session({ cookie: { maxAge: 60000 }, 
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
app.get('/', (req, res)=>{
    if(!req.session.user){
        res.redirect('/login');
        return;
    }

    // Execute on successfully fetching list of meetings
    function success(data){
        let meetings = data;
        res.render('index', {user: req.session.user, meetings:meetings});
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
        req.session.user = psid;
        return res.redirect('/');
        return;
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
    let owner = req.session.user;
    let agenda = req.body.agenda.split(',');
    let id = req.params['id'];

    console.log('Getting Participants...');
    getParticipants(id, success);

    function success(data){
        console.log(data);
        res.render('meeting', {subject: subject,
            location: location,
            datetime: datetime,
            owner: owner,
            agenda: agenda,
            id: id,
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
    let text = 'Notes:<br>' + notes + '<br>Action Items<br>' + actionItems;
    sendMail('anjum.salman@outlook.com', text);
});

/*--------- Socket IO ---------*/
io.on('connection', (socket)=>{
    console.log('Socket connection made');

    let recognitionStream = null;

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
            metadata: recognitionMetadata
        },
    interimResults: false
    }

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

// Database functions
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
function createMeeting(subject_, location_, datetime_, owner_, agenda_, saveData){
    let sql = "INSERT INTO meeting(subject,location,status,datetime_,owner,agenda) VALUES ('"+
            subject_+"','"+location_+"','N','"+datetime_+"',"+owner_+",'"+agenda_+"')";
    conn.query(sql, (err, results, fields)=>{
        if(err)
            console.log('Error:' + err.message);
        saveData(results.insertId);
    });
}

// Starting meeting
function startMeeting(meeting_id){
    let sql = "UPDATE TABLE meeting SET status='Y' WHERE id=" + meeting_id;
    conn.query(sql);
}

// Get meeting list
function getMeetingList(owner, success){
    let sql = 'SELECT * FROM meeting WHERE owner=?';
    conn.query(sql, [owner], (error, rows, fields)=>{
        if(rows.length>0)
            success(rows);
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

// Dailog Responses
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