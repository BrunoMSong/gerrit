import static com.google.common.truth.Truth.assertWithMessage;
import com.google.gerrit.common.UsedAt;
import com.google.gerrit.common.UsedAt.Project;
import com.google.gerrit.entities.Account;
import com.google.gerrit.entities.Change;
import com.google.gerrit.entities.PatchSet;
    PushOneCommit create(PersonIdent i, TestRepository<?> testRepo);
        PersonIdent i, TestRepository<?> testRepo, @Assisted("changeId") String changeId);
    @UsedAt(Project.PLUGIN_CODE_OWNERS)
    PushOneCommit create(
        PersonIdent i,
        TestRepository<?> testRepo,
        @Assisted("subject") String subject,
        @Assisted Map<String, String> files,
        @Assisted("changeId") String changeId);

    this(notesFactory, approvalsUtil, queryProvider, i, testRepo, SUBJECT, FILE_NAME, FILE_CONTENT);
    this(notesFactory, approvalsUtil, queryProvider, i, testRepo, subject, fileName, content, null);
    this(notesFactory, approvalsUtil, queryProvider, i, testRepo, subject, files, null);
  @AssistedInject
  PushOneCommit(
      @Assisted PersonIdent i,
      @Assisted TestRepository<?> testRepo,
      @Assisted("subject") String subject,
      @Assisted Map<String, String> files,
      @Nullable @Assisted("changeId") String changeId)
    public ChangeData getChange() {
    public PatchSet getPatchSet() {
    public PatchSet.Id getPatchSetId() {
        Change.Status expectedStatus, String expectedTopic, TestAccount... expectedReviewers) {
        List<TestAccount> expectedCcs) {
      assertReviewers(c, ReviewerStateInternal.REVIEWER, expectedReviewers);
      assertReviewers(c, ReviewerStateInternal.CC, expectedCcs);
        Change c, ReviewerStateInternal state, List<TestAccount> expectedReviewers) {
          approvalsUtil.getReviewers(notesFactory.createChecked(c)).byState(state);
      assertWithMessage(message(refUpdate))
          .that(refUpdate.getStatus())
      assertWithMessage(message(refUpdate)).that(refUpdate.getStatus()).isEqualTo(expectedStatus);