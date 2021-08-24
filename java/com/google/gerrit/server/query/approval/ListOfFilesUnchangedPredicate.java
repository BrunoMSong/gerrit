// Copyright (C) 2021 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package com.google.gerrit.server.query.approval;

import com.google.gerrit.entities.Patch.ChangeType;
import com.google.gerrit.entities.PatchSet;
import com.google.gerrit.entities.Project;
import com.google.gerrit.exceptions.StorageException;
import com.google.gerrit.index.query.Predicate;
import com.google.gerrit.server.git.GitRepositoryManager;
import com.google.gerrit.server.patch.DiffNotAvailableException;
import com.google.gerrit.server.patch.DiffOperations;
import com.google.gerrit.server.patch.filediff.FileDiffOutput;
import com.google.inject.Inject;
import com.google.inject.Singleton;
import java.io.IOException;
import java.util.Collection;
import java.util.Map;
import java.util.Objects;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevWalk;

/** Predicate that matches when the new patch-set includes the same files as the old patch-set. */
@Singleton
public class ListOfFilesUnchangedPredicate extends ApprovalPredicate {
  private final DiffOperations diffOperations;
  private final GitRepositoryManager repositoryManager;

  @Inject
  public ListOfFilesUnchangedPredicate(
      DiffOperations diffOperations, GitRepositoryManager repositoryManager) {
    this.diffOperations = diffOperations;
    this.repositoryManager = repositoryManager;
  }

  @Override
  public boolean match(ApprovalContext ctx) {
    PatchSet targetPatchSet = ctx.changeNotes().getPatchSets().get(ctx.target());
    PatchSet sourcePatchSet =
        ctx.changeNotes().getPatchSets().get(ctx.patchSetApproval().patchSetId());

    Integer parentNum =
        isInitialCommit(ctx.changeNotes().getProjectName(), targetPatchSet.commitId()) ? 0 : 1;
    try {
      Map<String, FileDiffOutput> modifiedTargetPatchSet =
          diffOperations.listModifiedFilesAgainstParent(
              ctx.changeNotes().getProjectName(), targetPatchSet.commitId(), parentNum);
      Map<String, FileDiffOutput> modifiedSourcePatchSet =
          diffOperations.listModifiedFilesAgainstParent(
              ctx.changeNotes().getProjectName(), sourcePatchSet.commitId(), parentNum);
      return match(modifiedTargetPatchSet, modifiedSourcePatchSet);
    } catch (DiffNotAvailableException ex) {
      throw new StorageException(
          "failed to compute difference in files, so won't copy"
              + " votes on labels even if list of files is the same and "
              + "copyAllIfListOfFilesDidNotChange",
          ex);
    }
  }

  /**
   * returns {@code true} if the files that were modified are the same in both inputs, and the
   * {@link ChangeType} matches for each modified file.
   */
  public boolean match(
      Map<String, FileDiffOutput> modifiedFiles1, Map<String, FileDiffOutput> modifiedFiles2) {
    if (modifiedFiles1.size() != modifiedFiles2.size()) {
      return false;
    }
    for (String file : modifiedFiles1.keySet()) {
      FileDiffOutput fileDiffOutput1 = modifiedFiles1.get(file);
      FileDiffOutput fileDiffOutput2 = modifiedFiles2.get(file);
      if (fileDiffOutput2 == null) {
        return false;
      }
      if (!fileDiffOutput2.changeType().equals(fileDiffOutput1.changeType())) {
        return false;
      }
    }
    return true;
  }

  public boolean isInitialCommit(Project.NameKey project, ObjectId objectId) {
    try (Repository repo = repositoryManager.openRepository(project);
        RevWalk revWalk = new RevWalk(repo)) {
      return revWalk.parseCommit(objectId).getParentCount() == 0;
    } catch (IOException ex) {
      throw new StorageException(ex);
    }
  }

  @Override
  public Predicate<ApprovalContext> copy(
      Collection<? extends Predicate<ApprovalContext>> children) {
    return new ListOfFilesUnchangedPredicate(diffOperations, repositoryManager);
  }

  @Override
  public int hashCode() {
    return Objects.hash(diffOperations, repositoryManager);
  }

  @Override
  public boolean equals(Object other) {
    if (!(other instanceof ListOfFilesUnchangedPredicate)) {
      return false;
    }
    ListOfFilesUnchangedPredicate o = (ListOfFilesUnchangedPredicate) other;
    return Objects.equals(o.diffOperations, diffOperations)
        && Objects.equals(o.repositoryManager, repositoryManager);
  }
}
