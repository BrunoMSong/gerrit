// Copyright (C) 2019 The Android Open Source Project
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

package com.google.gerrit.acceptance.api.change;

import static com.google.common.collect.ImmutableList.toImmutableList;
import static com.google.common.truth.Truth.assertThat;
import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.joining;

import com.google.common.base.Joiner;
import com.google.common.base.MoreObjects;
import com.google.common.collect.ImmutableListMultimap;
import com.google.common.io.CharStreams;
import com.google.common.reflect.TypeToken;
import com.google.gerrit.acceptance.AbstractDaemonTest;
import com.google.gerrit.acceptance.RestResponse;
import com.google.gerrit.acceptance.UseSsh;
import com.google.gerrit.common.Nullable;
import com.google.gerrit.extensions.annotations.Exports;
import com.google.gerrit.extensions.common.ChangeInfo;
import com.google.gerrit.extensions.common.PluginDefinedInfo;
import com.google.gerrit.json.OutputFormat;
import com.google.gerrit.reviewdb.client.Change;
import com.google.gerrit.server.DynamicOptions.DynamicBean;
import com.google.gerrit.server.change.ChangeAttributeFactory;
import com.google.gerrit.server.query.change.OutputStreamQuery;
import com.google.gerrit.server.restapi.change.GetChange;
import com.google.gerrit.server.restapi.change.QueryChanges;
import com.google.gerrit.sshd.commands.Query;
import com.google.gson.Gson;
import com.google.inject.AbstractModule;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Stream;
import org.junit.Test;
import org.kohsuke.args4j.Option;

@UseSsh
public class PluginFieldsIT extends AbstractDaemonTest {
  private static final Gson REST_GSON = OutputFormat.JSON.newGson();
  private static final Gson SSH_GSON = OutputStreamQuery.GSON;

  static class MyInfo extends PluginDefinedInfo {
    @Nullable String theAttribute;

    MyInfo(@Nullable String theAttribute) {
      this.theAttribute = theAttribute;
    }

    MyInfo(String name, @Nullable String theAttribute) {
      this.name = requireNonNull(name);
      this.theAttribute = theAttribute;
    }

    @Override
    public boolean equals(Object o) {
      if (!(o instanceof MyInfo)) {
        return false;
      }
      MyInfo i = (MyInfo) o;
      return Objects.equals(name, i.name) && Objects.equals(theAttribute, i.theAttribute);
    }

    @Override
    public int hashCode() {
      return Objects.hash(name, theAttribute);
    }

    @Override
    public String toString() {
      return MoreObjects.toStringHelper(this)
          .add("name", name)
          .add("theAttribute", theAttribute)
          .toString();
    }
  }

  static class NullAttributeModule extends AbstractModule {
    @Override
    public void configure() {
      bind(ChangeAttributeFactory.class)
          .annotatedWith(Exports.named("null"))
          .toInstance((cd, bp, p) -> null);
    }
  }

  static class SimpleAttributeModule extends AbstractModule {
    @Override
    public void configure() {
      bind(ChangeAttributeFactory.class)
          .annotatedWith(Exports.named("simple"))
          .toInstance((cd, bp, p) -> new MyInfo("change " + cd.getId()));
    }
  }

  static class MyOptions implements DynamicBean {
    @Option(name = "--opt")
    private String opt;
  }

  static class OptionAttributeModule extends AbstractModule {
    @Override
    public void configure() {
      bind(ChangeAttributeFactory.class)
          .annotatedWith(Exports.named("simple"))
          .toInstance(
              (cd, bp, p) -> {
                MyOptions opts = (MyOptions) bp.getDynamicBean(p);
                return opts != null ? new MyInfo("opt " + opts.opt) : null;
              });
      bind(DynamicBean.class).annotatedWith(Exports.named(Query.class)).to(MyOptions.class);
      bind(DynamicBean.class).annotatedWith(Exports.named(QueryChanges.class)).to(MyOptions.class);
      bind(DynamicBean.class).annotatedWith(Exports.named(GetChange.class)).to(MyOptions.class);
    }
  }

  @Test
  public void queryChangeApiWithNullAttribute() throws Exception {
    getChangeWithNullAttribute(
        id -> pluginInfoFromSingletonList(gApi.changes().query(id.toString()).get()));
  }

  @Test
  public void queryChangeRestWithNullAttribute() throws Exception {
    getChangeWithNullAttribute(
        id -> pluginInfoFromSingletonListRest(adminRestSession.get(changeQueryUrl(id))));
  }

  @Test
  public void queryChangeSshWithNullAttribute() throws Exception {
    getChangeWithNullAttribute(
        id -> pluginInfoFromSingletonListSsh(adminSshSession.exec(changeQueryCmd(id))));
  }

  @Test
  public void getChangeApiWithNullAttribute() throws Exception {
    getChangeWithNullAttribute(
        id -> pluginInfoFromChangeInfo(gApi.changes().id(id.toString()).get()));
  }

  @Test
  public void getChangeRestWithNullAttribute() throws Exception {
    getChangeWithNullAttribute(
        id -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeUrl(id))));
  }

  @Test
  public void getChangeDetailRestWithNullAttribute() throws Exception {
    getChangeWithNullAttribute(
        id -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeDetailUrl(id))));
  }

  // No tests for /detail via the extension API, since the extension API doesn't have that method.
  // No tests for getting a single change over SSH, since the only API is the query API.

  private void getChangeWithNullAttribute(PluginInfoGetter getter) throws Exception {
    Change.Id id = createChange().getChange().getId();
    assertThat(getter.call(id)).isNull();

    try (AutoCloseable ignored = installPlugin("my-plugin", NullAttributeModule.class)) {
      assertThat(getter.call(id)).isNull();
    }

    assertThat(getter.call(id)).isNull();
  }

  @Test
  public void queryChangeApiWithSimpleAttribute() throws Exception {
    getChangeWithSimpleAttribute(
        id -> pluginInfoFromSingletonList(gApi.changes().query(id.toString()).get()));
  }

  @Test
  public void queryChangeRestWithSimpleAttribute() throws Exception {
    getChangeWithSimpleAttribute(
        id -> pluginInfoFromSingletonListRest(adminRestSession.get(changeQueryUrl(id))));
  }

  @Test
  public void queryChangeSshWithSimpleAttribute() throws Exception {
    getChangeWithSimpleAttribute(
        id -> pluginInfoFromSingletonListSsh(adminSshSession.exec(changeQueryCmd(id))));
  }

  @Test
  public void getChangeApiWithSimpleAttribute() throws Exception {
    getChangeWithSimpleAttribute(
        id -> pluginInfoFromChangeInfo(gApi.changes().id(id.toString()).get()));
  }

  @Test
  public void getChangeRestWithSimpleAttribute() throws Exception {
    getChangeWithSimpleAttribute(
        id -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeUrl(id))));
  }

  @Test
  public void getChangeDetailRestWithSimpleAttribute() throws Exception {
    getChangeWithSimpleAttribute(
        id -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeDetailUrl(id))));
  }

  // No tests for getting a single change over SSH, since the only API is the query API.

  private void getChangeWithSimpleAttribute(PluginInfoGetter getter) throws Exception {
    Change.Id id = createChange().getChange().getId();
    assertThat(getter.call(id)).isNull();

    try (AutoCloseable ignored = installPlugin("my-plugin", SimpleAttributeModule.class)) {
      assertThat(getter.call(id)).containsExactly(new MyInfo("my-plugin", "change " + id));
    }

    assertThat(getter.call(id)).isNull();
  }

  @Test
  public void queryChangeSshWithOption() throws Exception {
    getChangeWithOption(
        id -> pluginInfoFromSingletonListSsh(adminSshSession.exec(changeQueryCmd(id))),
        (id, opts) ->
            pluginInfoFromSingletonListSsh(adminSshSession.exec(changeQueryCmd(id, opts))));
  }

  @Test
  public void queryChangeRestWithOption() throws Exception {
    getChangeWithOption(
        id -> pluginInfoFromSingletonListRest(adminRestSession.get(changeQueryUrl(id))),
        (id, opts) ->
            pluginInfoFromSingletonListRest(adminRestSession.get(changeQueryUrl(id, opts))));
  }

  @Test
  public void getChangeRestWithOption() throws Exception {
    getChangeWithOption(
        id -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeUrl(id))),
        (id, opts) -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeUrl(id, opts))));
  }

  @Test
  public void getChangeDetailRestWithOption() throws Exception {
    getChangeWithOption(
        id -> pluginInfoFromChangeInfoRest(adminRestSession.get(changeDetailUrl(id))),
        (id, opts) ->
            pluginInfoFromChangeInfoRest(adminRestSession.get(changeDetailUrl(id, opts))));
  }

  // No tests for /detail via the extension API, since the extension API doesn't have that method.
  // No tests for getting a single change over SSH, since the only API is the query API.

  // TODO(dborowitz): Add extension API support for passing plugin options.

  private void getChangeWithOption(
      PluginInfoGetter getterWithoutOptions, PluginInfoGetterWithOptions getterWithOptions)
      throws Exception {
    Change.Id id = createChange().getChange().getId();
    assertThat(getterWithoutOptions.call(id)).isNull();

    try (AutoCloseable ignored = installPlugin("my-plugin", OptionAttributeModule.class)) {
      assertThat(getterWithoutOptions.call(id))
          .containsExactly(new MyInfo("my-plugin", "opt null"));
      assertThat(getterWithOptions.call(id, ImmutableListMultimap.of("my-plugin--opt", "foo")))
          .containsExactly(new MyInfo("my-plugin", "opt foo"));
    }

    assertThat(getterWithoutOptions.call(id)).isNull();
  }

  private String changeQueryUrl(Change.Id id) {
    return changeQueryUrl(id, ImmutableListMultimap.of());
  }

  private String changeQueryUrl(Change.Id id, ImmutableListMultimap<String, String> opts) {
    String url = "/changes/?q=" + id;
    String queryString = buildQueryString(opts);
    if (!queryString.isEmpty()) {
      url += "&" + queryString;
    }
    return url;
  }

  private String changeQueryCmd(Change.Id id) {
    return changeQueryCmd(id, ImmutableListMultimap.of());
  }

  private String changeQueryCmd(Change.Id id, ImmutableListMultimap<String, String> pluginOptions) {
    return "gerrit query --format json "
        + pluginOptions.entries().stream()
            .flatMap(e -> Stream.of("--" + e.getKey(), e.getValue()))
            .collect(joining(" "))
        + " "
        + id;
  }

  private String changeUrl(Change.Id id) {
    return changeUrl(id, ImmutableListMultimap.of());
  }

  private String changeUrl(Change.Id id, ImmutableListMultimap<String, String> pluginOptions) {
    return changeUrl(id, "", pluginOptions);
  }

  private String changeDetailUrl(Change.Id id) {
    return changeDetailUrl(id, ImmutableListMultimap.of());
  }

  private String changeDetailUrl(
      Change.Id id, ImmutableListMultimap<String, String> pluginOptions) {
    return changeUrl(id, "/detail", pluginOptions);
  }

  private String changeUrl(
      Change.Id id, String suffix, ImmutableListMultimap<String, String> pluginOptions) {
    String url = "/changes/" + project + "~" + id + suffix;
    String queryString = buildQueryString(pluginOptions);
    if (!queryString.isEmpty()) {
      url += "?" + queryString;
    }
    return url;
  }

  private static String buildQueryString(ImmutableListMultimap<String, String> opts) {
    return Joiner.on('&').withKeyValueSeparator('=').join(opts.entries());
  }

  private static List<MyInfo> pluginInfoFromSingletonList(List<ChangeInfo> changeInfos) {
    assertThat(changeInfos).hasSize(1);
    return pluginInfoFromChangeInfo(changeInfos.get(0));
  }

  private static List<MyInfo> pluginInfoFromChangeInfo(ChangeInfo changeInfo) {
    List<PluginDefinedInfo> pluginInfo = changeInfo.plugins;
    if (pluginInfo == null) {
      return null;
    }
    return pluginInfo.stream().map(MyInfo.class::cast).collect(toImmutableList());
  }

  @Nullable
  private static List<MyInfo> pluginInfoFromSingletonListRest(RestResponse res) throws Exception {
    res.assertOK();

    // Don't deserialize to ChangeInfo directly, since that would treat the plugins field as
    // List<PluginDefinedInfo> and ignore the unknown keys found in MyInfo.
    List<Map<String, Object>> changeInfos =
        REST_GSON.fromJson(
            res.getReader(), new TypeToken<List<Map<String, Object>>>() {}.getType());
    assertThat(changeInfos).hasSize(1);
    return myInfo(changeInfos.get(0));
  }

  @Nullable
  private static List<MyInfo> pluginInfoFromSingletonListSsh(String sshOutput) throws Exception {
    List<Map<String, Object>> changeAttrs = new ArrayList<>();
    for (String line : CharStreams.readLines(new StringReader(sshOutput))) {
      // Don't deserialize to ChangeAttribute directly, since that would treat the plugins field as
      // List<PluginDefinedInfo> and ignore the unknown keys found in MyInfo.
      Map<String, Object> changeAttr =
          SSH_GSON.fromJson(line, new TypeToken<Map<String, Object>>() {}.getType());
      if (!"stats".equals(changeAttr.get("type"))) {
        changeAttrs.add(changeAttr);
      }
    }

    assertThat(changeAttrs).hasSize(1);

    Object plugins = changeAttrs.get(0).get("plugins");
    if (plugins == null) {
      return null;
    }
    return SSH_GSON.fromJson(SSH_GSON.toJson(plugins), new TypeToken<List<MyInfo>>() {}.getType());
  }

  @Nullable
  private List<MyInfo> pluginInfoFromChangeInfoRest(RestResponse res) throws Exception {
    res.assertOK();

    // Don't deserialize to ChangeInfo directly, since that would treat the plugins field as
    // List<PluginDefinedInfo> and ignore the unknown keys found in MyInfo.
    return myInfo(
        REST_GSON.fromJson(res.getReader(), new TypeToken<Map<String, Object>>() {}.getType()));
  }

  private static List<MyInfo> myInfo(Map<String, Object> changeInfo) {
    Object plugins = changeInfo.get("plugins");
    if (plugins == null) {
      return null;
    }
    return REST_GSON.fromJson(
        REST_GSON.toJson(plugins), new TypeToken<List<MyInfo>>() {}.getType());
  }

  @FunctionalInterface
  private interface PluginInfoGetter {
    List<MyInfo> call(Change.Id id) throws Exception;
  }

  @FunctionalInterface
  private interface PluginInfoGetterWithOptions {
    List<MyInfo> call(Change.Id id, ImmutableListMultimap<String, String> pluginOptions)
        throws Exception;
  }
}
