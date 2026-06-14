import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// ミリ秒を mm:ss 表記に
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  // 録音ファイル URI の変化を親へ通知（将来 transcribeAudio(uri) に渡せる）
  onRecordingChange?: (uri: string | null) => void;
}

export default function VoiceRecorder({ onRecordingChange }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 録音済みファイルの再生用プレイヤー（URI が変わると差し替わる）
  const player = useAudioPlayer(recordedUri ?? undefined);

  const isRecording = recorderState.isRecording;

  async function startRecording() {
    setErrorMsg(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setErrorMsg('マイクの使用が許可されていません。');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      setErrorMsg('録音を開始できませんでした。');
    }
  }

  async function stopRecording() {
    try {
      const durationAtStop = recorderState.durationMillis;
      await recorder.stop();
      const uri = recorder.uri ?? null;
      setRecordedUri(uri);
      setRecordedDuration(durationAtStop);
      onRecordingChange?.(uri);
    } catch (e) {
      setErrorMsg('録音を停止できませんでした。');
    }
  }

  function playRecording() {
    if (!recordedUri) return;
    try {
      player.seekTo(0);
      player.play();
    } catch (e) {
      setErrorMsg('再生できませんでした。');
    }
  }

  function deleteRecording() {
    setRecordedUri(null);
    setRecordedDuration(0);
    setErrorMsg(null);
    onRecordingChange?.(null);
  }

  // 状態表示テキスト
  const statusLabel = isRecording
    ? '● 録音中'
    : recordedUri
      ? '■ 録音あり'
      : '録音なし';

  // 表示する時間（録音中はライブ、停止後は録音時間）
  const displayMs = isRecording ? recorderState.durationMillis : recordedDuration;

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <ThemedView style={styles.statusRow}>
        <ThemedText type="smallBold" style={isRecording ? styles.recordingText : undefined}>
          {statusLabel}
        </ThemedText>
        <ThemedText type="smallBold">{formatDuration(displayMs)}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.buttonRow}>
        {!isRecording ? (
          <Pressable onPress={startRecording} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView style={[styles.btn, styles.recordBtn]}>
              <ThemedText type="smallBold" style={styles.btnLight}>
                ⏺ 録音開始
              </ThemedText>
            </ThemedView>
          </Pressable>
        ) : (
          <Pressable onPress={stopRecording} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView style={[styles.btn, styles.stopBtn]}>
              <ThemedText type="smallBold" style={styles.btnLight}>
                ⏹ 停止
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}

        <Pressable
          onPress={playRecording}
          disabled={!recordedUri || isRecording}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView
            type="backgroundSelected"
            style={[styles.btn, (!recordedUri || isRecording) && styles.btnDisabled]}>
            <ThemedText type="smallBold">▶ 再生</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={deleteRecording}
          disabled={!recordedUri || isRecording}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView
            type="backgroundSelected"
            style={[styles.btn, (!recordedUri || isRecording) && styles.btnDisabled]}>
            <ThemedText type="smallBold" style={styles.deleteText}>
              🗑 削除
            </ThemedText>
          </ThemedView>
        </Pressable>
      </ThemedView>

      {Platform.OS === 'web' && (
        <ThemedText type="small" themeColor="textSecondary">
          ※ Web ではブラウザのマイク許可が必要です。
        </ThemedText>
      )}
      {errorMsg && (
        <ThemedText type="small" style={styles.errorText}>
          {errorMsg}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recordingText: { color: '#E5484D' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  btn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  recordBtn: { backgroundColor: '#E5484D' },
  stopBtn: { backgroundColor: '#44474E' },
  btnLight: { color: '#ffffff' },
  btnDisabled: { opacity: 0.4 },
  deleteText: { color: '#E5484D' },
  errorText: { color: '#E5484D' },
  pressed: { opacity: 0.6 },
});
