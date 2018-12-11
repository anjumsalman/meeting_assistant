const socket = io.connect();
let startTime = new Date().getTime();

// Audiostream configuration
const constraints = {
    audio: true,
    video: false
}

// UI Elements
let startButton = document.querySelector('.meeting-start');
let stopButton = document.querySelector('.transcript-stop');
let transcriptBody = document.querySelector('.transcript-text');
let reminderDivs = [];
let reminderWords = [];
let participantSpans = [];
let participantNames = [];

let context, processor, input, globalStream;

function initRecording() {
    // Get list of all reminder divs
    reminderDivs = document.querySelectorAll('.reminder-item');
    for(let reminderDiv of reminderDivs){
        reminderWords.push(reminderDiv.innerText);
    }

    // Get list of all participant spans
    participantSpans = document.querySelectorAll('.participant');
    for(let participantSpan of participantSpans){
        participantNames.push(participantSpan.innerText);
    }

	socket.emit('speechInit', '');
    
    context = new AudioContext();
	processor = context.createScriptProcessor(2048, 1, 1);
	processor.connect(context.destination);
	context.resume();

	var handleSuccess = function (stream) {
		globalStream = stream;
		input = context.createMediaStreamSource(stream);
		input.connect(processor);

		processor.onaudioprocess = function (e) {
			microphoneProcess(e);
		};
	};

	navigator.mediaDevices.getUserMedia(constraints)
		.then(handleSuccess);

}

function microphoneProcess(e) {
	var left = e.inputBuffer.getChannelData(0);
	var left16 = downsampleBuffer(left, 44100, 16000)
	socket.emit('speechData', left16);
}

// Socket Events
socket.on('textData', (data)=>{
    console.log(data);
    transcriptBody.innerHTML += data.results[0].alternatives[0].transcript;
    //transcriptBody.innerHTML = transformTextData(data.results[0].alternatives[0].words);

    // Colorise reminder if reminded
    let freqArray = wordFrequency(transcriptBody.innerHTML, reminderWords, 4);
    for(reminderDiv of reminderDivs){
        for(e of freqArray){
            if(e==reminderDiv.innerText.toUpperCase()){
                reminderDiv.style.backgroundColor = 'green';
                reminderDiv.style.color = 'white';
            }
        }
    }

    // Recognize Participant
    if(new Date().getTime() - startTime <= 300000){
        let namesArray = participantPresent(transcriptBody.innerText, participantNames);
        for(participantSpan of participantSpans){
            for(e of namesArray){
                if(participantSpan.innerText.match(new RegExp(e, 'i'))!=null){
                    participantSpan.style.backgroundColor = 'green';
                    participantSpan.style.color = 'white';
                }
            }
        }
    }
})

// UI Events
startButton.addEventListener('click', (e)=>{
    initRecording();
});

stopButton.addEventListener('click', (e)=>{
    socket.emit('speechEnd', '');
});

// Helper Functions
function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate == sampleRate) {
        return buffer;
    }
    if (outSampleRate > sampleRate) {
        throw "downsampling rate show be smaller than original sample rate";
    }
    var sampleRateRatio = sampleRate / outSampleRate;
    var newLength = Math.round(buffer.length / sampleRateRatio);
    var result = new Int16Array(newLength);
    var offsetResult = 0;
    var offsetBuffer = 0;
    while (offsetResult < result.length) {
        var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        var accum = 0, count = 0;
        for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }

        result[offsetResult] = Math.min(1, accum / count)*0x7FFF;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result.buffer;
}

function transformTextData(textArray){
    let text = '';
    let speaker = null;
    textArray.forEach(element => {
        wordSpeaker = element.speakerTag;
        if(speaker == null){
            text += '<b>'+wordSpeaker+'</b>' + ': ' + element.word;
        }else{
            if(wordSpeaker == speaker){
                text += ' ' + element.word;
            }else{
                text += '<br>' + '<b>'+wordSpeaker+'</b>'+ ': ' + element.word;
            }
        }
        speaker = wordSpeaker;
    });

    return text;
}

function wordFrequency(text, words, frequency){
    let freqArray = [];
    for(word of words){
        if(count(text.toUpperCase(), word.toUpperCase(), true)>=frequency){
            freqArray.push(word.toUpperCase());
        }
    }

    console.log(freqArray);
    return freqArray;
}

function count(string, subString, allowOverlapping) {
    string += "";
    subString += "";
    if (subString.length <= 0) return (string.length + 1);

    var n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else break;
    }
    return n;
}

function participantPresent(text, participantNames){
    let presentArray = [];
    let firstNames = [];
    
    // Get the first names
    for(name of participantNames){
        firstNames.push(name.split(' ')[0]);
    }

    for(name of firstNames){
        if(text.match(new RegExp(name, 'i')) != null){
            presentArray.push(name);
        }
    }

    return presentArray;
}