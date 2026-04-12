import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { GradingDetails, QuestionScore } from '../types';

interface GradingDetailsModalProps {
  visible: boolean;
  details: GradingDetails | null;
  studentName: string;
  onClose: () => void;
}

function QuestionRow({ q, type }: { q: QuestionScore; type: 'wrong' | 'unanswered' | 'correct' }) {
  const bgColor =
    type === 'wrong' ? colors.redLight : type === 'unanswered' ? colors.amberLight : colors.greenLight;
  const textColor =
    type === 'wrong' ? colors.red : type === 'unanswered' ? colors.amber : colors.green;

  return (
    <View style={[styles.questionRow, { backgroundColor: bgColor }]}>
      <Text style={[styles.questionNumber, { color: textColor }]}>Q{q.question_number}</Text>
      <View style={styles.questionContent}>
        {q.student_answer ? (
          <Text style={styles.answerText}>Student: {q.student_answer}</Text>
        ) : null}
        <Text style={styles.answerText}>Correct: {q.correct_answer}</Text>
        {q.feedback ? <Text style={styles.feedbackText}>{q.feedback}</Text> : null}
      </View>
    </View>
  );
}

export function GradingDetailsModal({
  visible,
  details,
  studentName,
  onClose,
}: GradingDetailsModalProps) {
  if (!details) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Grading Details</Text>
            <Text style={styles.subtitle}>{studentName}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {/* Summary */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { backgroundColor: colors.greenLight }]}>
              <Text style={[styles.summaryValue, { color: colors.green }]}>
                {details.correct_answers}
              </Text>
              <Text style={styles.summaryLabel}>Correct</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.redLight }]}>
              <Text style={[styles.summaryValue, { color: colors.red }]}>
                {details.wrong_answers}
              </Text>
              <Text style={styles.summaryLabel}>Wrong</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.amberLight }]}>
              <Text style={[styles.summaryValue, { color: colors.amber }]}>
                {details.unanswered}
              </Text>
              <Text style={styles.summaryLabel}>Unanswered</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.blueLight }]}>
              <Text style={[styles.summaryValue, { color: colors.blue }]}>
                {Math.round(details.grade_percentage)}%
              </Text>
              <Text style={styles.summaryLabel}>Score</Text>
            </View>
          </View>

          {/* Feedback */}
          {details.overall_feedback ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Feedback</Text>
              <Text style={styles.feedbackBody}>{details.overall_feedback}</Text>
            </View>
          ) : null}

          {/* Wrong */}
          {details.wrong_questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Wrong Answers ({details.wrong_questions.length})
              </Text>
              {details.wrong_questions.map((q) => (
                <QuestionRow key={q.question_number} q={q} type="wrong" />
              ))}
            </View>
          )}

          {/* Unanswered */}
          {details.unanswered_questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Unanswered ({details.unanswered_questions.length})
              </Text>
              {details.unanswered_questions.map((q) => (
                <QuestionRow key={q.question_number} q={q} type="unanswered" />
              ))}
            </View>
          )}

          {/* Correct (collapsed) */}
          {details.correct_questions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Correct ({details.correct_questions.length})
              </Text>
              {details.correct_questions.slice(0, 5).map((q) => (
                <QuestionRow key={q.question_number} q={q} type="correct" />
              ))}
              {details.correct_questions.length > 5 && (
                <Text style={styles.moreText}>
                  +{details.correct_questions.length - 5} more
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.gray900,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: 2,
  },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  summaryValue: {
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    color: colors.gray600,
    marginTop: 2,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.gray800,
    marginBottom: spacing.sm,
  },
  questionRow: {
    flexDirection: 'row',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  questionNumber: {
    fontWeight: '700',
    fontSize: fontSize.sm,
    width: 36,
  },
  questionContent: {
    flex: 1,
  },
  answerText: {
    fontSize: fontSize.sm,
    color: colors.gray700,
  },
  feedbackText: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    fontStyle: 'italic',
    marginTop: 2,
  },
  feedbackBody: {
    fontSize: fontSize.sm,
    color: colors.gray700,
    lineHeight: 20,
  },
  moreText: {
    fontSize: fontSize.sm,
    color: colors.gray400,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
