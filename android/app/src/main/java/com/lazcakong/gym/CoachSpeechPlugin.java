package com.lazcakong.gym;

import android.media.AudioAttributes;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "CoachSpeech")
public final class CoachSpeechPlugin extends Plugin {
    private TextToSpeech engine;
    private boolean ready;
    private PluginCall pending;
    private String utteranceId;

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > TextToSpeech.getMaxSpeechInputLength()) {
            call.reject("El texto está vacío o excede el límite de voz.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            cancelPending();
            pending = call;
            if (ready) {
                speakPending();
            } else if (engine == null) {
                engine = new TextToSpeech(getContext(), status ->
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> initialize(status)));
            }
        });
    }

    private void initialize(int status) {
        if (engine == null) return;
        if (status != TextToSpeech.SUCCESS ||
            (engine.setLanguage(Locale.forLanguageTag("es-CL")) < 0 &&
             engine.setLanguage(new Locale("es")) < 0)) {
            if (pending != null) pending.reject("Activa o instala una voz en español en Android.");
            pending = null;
            engine.shutdown();
            engine = null;
            return;
        }
        engine.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { finish(id, true); }
            @Override public void onError(String id) { finish(id, false); }
        });
        ready = true;
        speakPending();
    }

    private void speakPending() {
        if (pending == null) return;
        utteranceId = UUID.randomUUID().toString();
        if (engine.speak(pending.getString("text", "").trim(),
            TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.ERROR) {
            finish(utteranceId, false);
        }
    }

    private void finish(String id, boolean success) {
        getActivity().runOnUiThread(() -> {
            if (!id.equals(utteranceId) || pending == null) return;
            if (success) pending.resolve();
            else pending.reject("Android no pudo reproducir el consejo.");
            pending = null;
            utteranceId = null;
        });
    }

    private void cancelPending() {
        if (pending != null) pending.reject("Lectura interrumpida.", "CANCELLED");
        pending = null;
        utteranceId = null;
        if (engine != null) engine.stop();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            cancelPending();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        cancelPending();
        if (engine != null) engine.shutdown();
        engine = null;
        ready = false;
        super.handleOnDestroy();
    }
}
