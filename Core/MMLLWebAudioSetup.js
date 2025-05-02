//Nick Collins 13/6/05 onset detection MIREX algorithm (adapted from SC3 UGen for stream based calculation)
//C code version Nick Collins 20 May 2005
//js version 2018
//trying to implement the best onset detection algo from AES118 paper, with event analysis data to be written to a buffer
//for potential NRT and RT use
//stores up to a second of audio, assumes that events are not longer than that minus a few FFT frames
//assumes 44100 SR and FFT of 1024, 512 overlap

import { MMLLInputAudio } from './MMLLSampler.js';
import { MMLLOutputAudio } from './MMLLSampler.js';
import { MMLLSampler } from './MMLLSampler.js';
import { MMLLSamplePlayer } from './MMLLSampler.js';

export function MMLLWebAudioSetup(blocksize, inputtype, callback, setup) {
    var self = this;
    
    self.audioblocksize = blocksize;
    self.inputtype = inputtype;
    self.inputAudio = new MMLLInputAudio(self.audioblocksize);
    self.outputAudio = new MMLLOutputAudio(self.audioblocksize);
    self.callback = callback;
    self.setup = setup;
    self.sampleRate = 0;
    self.audiocontext = 0;
    self.node = 0;
    self.numInputChannels = 1;
    self.audiorunning = false;
    self.currentSource = null;
    self.audioStream = null;
    self.audioBufferSource = null;

    self.switchAudioSource = function(newInputType, audioSource) {
        if (self.currentSource) {
            self.currentSource.disconnect();
            if (self.currentSource.stop) self.currentSource.stop();
            self.currentSource = null;
        }

        if (self.audiocontext) {
            self.audiocontext.close();
        }

        if (newInputType === 1 || newInputType === 2) {
            if (!navigator.getUserMedia) {
                navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia ||
                    navigator.mozGetUserMedia || navigator.msGetUserMedia;
            }
            
            navigator.getUserMedia({audio: true}, function(stream) {
                self.audioStream = stream;
                self.initAudio(stream);
            }, function(e) {
                console.error('Error getting audio:', e);
            });
        } else if (newInputType === 3) {
            if (audioSource instanceof AudioBuffer) {
                // Si ya tenemos el AudioBuffer
                self.audioBufferSource = self.audiocontext.createBufferSource();
                self.audioBufferSource.buffer = audioSource;
                self.currentSource = self.audioBufferSource;
                
                self.node = self.audiocontext.createScriptProcessor(blocksize, 0, 2);
                self.node.onaudioprocess = self.processSoundFile;
                self.audioBufferSource.connect(self.node);
                self.node.connect(self.audiocontext.destination);
                self.audioBufferSource.start(0);
            } else if (typeof audioSource === 'string') {
                // Si es una ruta, cargamos el archivo primero
                fetch(audioSource)
                    .then(response => response.arrayBuffer())
                    .then(arrayBuffer => self.audiocontext.decodeAudioData(arrayBuffer))
                    .then(audioBuffer => {
                        self.switchAudioSource(3, audioBuffer); // Llamada recursiva con el buffer
                    })
                    .catch(err => console.error('Error loading audio:', err));
            }
        } else {
            self.initAudio();
        }
    };

    self.usingMicrophone = function() {
        return ((self.inputtype == 1) || (self.inputtype == 2));
    };

    self.initAudio = function(inputstream) {
        if (self.audiorunning) {
            self.audiocontext.close();
        }

        try {
            self.audiocontext = new webkitAudioContext();
        } catch (e) {
            try {
                self.audiocontext = new AudioContext();
            } catch(e) {
                alert("Your browser does not support Web Audio API!");
                return;
            }
        }

        self.sampleRate = self.audiocontext.sampleRate;
        self.setup(self.sampleRate);

        if((self.inputtype == 1) || (self.inputtype == 2)) {
            var audioinput = self.audiocontext.createMediaStreamSource(inputstream);
            self.currentSource = audioinput;
            self.numInputChannels = self.inputtype;
            self.inputAudio.numChannels = self.numInputChannels;
            self.node = self.audiocontext.createScriptProcessor(self.audioblocksize,self.numInputChannels,2);
            audioinput.connect(self.node);
            self.node.onaudioprocess = self.process;
            self.node.connect(self.audiocontext.destination);
        } else {
            if(self.inputtype == 0) {
                self.node = self.audiocontext.createScriptProcessor(self.audioblocksize,0,2);
                self.node.onaudioprocess = self.synthesizeAudio;
                self.node.connect(self.audiocontext.destination);
            } else {
                self.initSoundFileRead(self.inputtype);
            }
        }
        self.audiorunning = true;
    };

    self.initSoundFileRead = function(filename) {
        self.sampler = new MMLLSampler();
        self.sampler.loadSamples([filename], function onload() {
            self.sampleplayer = new MMLLSamplePlayer();
            self.sampleplayer.reset(self.sampler.buffers[0]);
            
            if(self.sampleplayer.numChannels>1) {
                self.numInputChannels = 2;
                self.inputAudio.numChannels = self.numInputChannels;
            }

            self.audioBufferSource = self.audiocontext.createBufferSource();
            self.audioBufferSource.buffer = self.sampler.buffers[0];
            self.currentSource = self.audioBufferSource;

            self.node = self.audiocontext.createScriptProcessor(self.audioblocksize,0,2);
            self.node.onaudioprocess = self.processSoundFile;
            self.audioBufferSource.connect(self.node);
            self.node.connect(self.audiocontext.destination);
            self.audioBufferSource.start(0);
        }, self.audiocontext);
    };

    self.synthesizeAudio = function(event) {
        var outputArrayL = event.outputBuffer.getChannelData(0);
        var outputArrayR = event.outputBuffer.getChannelData(1);
        var n = outputArrayL.length;
        for (var i = 0; i < n; ++i) outputArrayL[i] = outputArrayR[i] = 0.0;
        self.outputAudio.outputL = outputArrayL;
        self.outputAudio.outputR = outputArrayR;
        self.callback(self.outputAudio,n);
    };

    self.processSoundFile = function(event) {
        var outputArrayL = event.outputBuffer.getChannelData(0);
        var outputArrayR = event.outputBuffer.getChannelData(1);
        var n = outputArrayL.length;
        for (var i = 0; i < n; ++i) self.inputAudio.monoinput[i] = self.inputAudio.inputL[i] = self.inputAudio.inputR[i] = 0.0;
        self.sampleplayer.render(self.inputAudio,n);
        for (var i = 0; i < n; ++i) outputArrayL[i] = outputArrayR[i] = 0.0;
        self.outputAudio.outputL = outputArrayL;
        self.outputAudio.outputR = outputArrayR;
        self.callback(self.inputAudio,self.outputAudio,n);
    };

    self.process = function(event) {
        var outputArrayL = event.outputBuffer.getChannelData(0);
        var outputArrayR = event.outputBuffer.getChannelData(1);
        var inputL = event.inputBuffer.getChannelData(0);
        var n = inputL.length;

        for (var i = 0; i < n; ++i) {
            let inputnow = inputL[i];
            if(inputnow>1.0) inputnow = 1.0;
            if(inputnow<-1.0) inputnow = -1.0;
            let absx = Math.abs(inputnow);
            inputL[i] = (absx > 1e-15 && absx < 1e15) ? inputnow : 0.;
        }

        if(self.numInputChannels == 2) {
            var inputR = event.inputBuffer.getChannelData(1);
            for (var i = 0; i < n; ++i) {
                let inputnow = inputR[i];
                if(inputnow>1.0) inputnow = 1.0;
                if(inputnow<-1.0) inputnow = -1.0;
                let absx = Math.abs(inputnow);
                inputR[i] = (absx > 1e-15 && absx < 1e15) ? inputnow : 0.;
            }

            var monoinput = self.inputAudio.monoinput;
            for (var i = 0; i < n; ++i) {
                monoinput[i] = (inputL[i]+inputR[i])*0.5;
            }
            
            self.inputAudio.inputL = inputL;
            self.inputAudio.inputR = inputR;
        } else {
            self.inputAudio.monoinput = inputL;
            self.inputAudio.inputL = inputL;
            self.inputAudio.inputR = inputL;
        }

        for (var i = 0; i < n; ++i) outputArrayL[i] = outputArrayR[i] = 0.0;
        self.outputAudio.outputL = outputArrayL;
        self.outputAudio.outputR = outputArrayR;
        self.callback(self.inputAudio,self.outputAudio,n);
    };

    console.log('init MMLLWebAudioSetup');
    if(inputtype == 1 || inputtype == 2) {
        if (!navigator.getUserMedia)
            navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia ||
             navigator.mozGetUserMedia || navigator.msGetUserMedia;
        
        navigator.getUserMedia({audio:true}, self.initAudio, function(e) {
                               alert('Error getting audio');
                               console.log(e);
                               });
    } else {
        self.initAudio();
    }
}