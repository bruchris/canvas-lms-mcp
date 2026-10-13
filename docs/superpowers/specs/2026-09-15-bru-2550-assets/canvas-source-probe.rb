# BRU-2550 probe. Executes Canvas master's OWN method bodies, extracted verbatim at
# runtime from instructure/canvas-lms@1c9f0bb8013e (default branch `master`), against
# request bodies parsed by the real Rails/Rack parameter parsers. It does NOT run
# Canvas: the DB and model layer are stubbed. What it proves is how Canvas's code
# interprets a given wire body, not what a hosted instance runs.
#
# WARNING: this script `eval`s Ruby that it extracts from files downloaded from the
# network (see the class_eval calls below). Run it ONLY inside a disposable container
# with actionpack pinned to 8.1.3.1; never directly on a developer machine or a CI
# runner. Reproduction steps: spec Appendix B. Its input wire.json comes from
# capture-wire.ts (dummy token, no Authorization header, no real Canvas instance).
require "action_controller"
require "action_dispatch"
require "json"
begin
  require "rack/mock_request"
rescue LoadError
  require "rack/mock"
end

WORK = ENV.fetch("WORK", "/work")
SRC = File.join(WORK, "cv")
RESULTS = []
def log(name, value)
  RESULTS << { case: name, result: value }
end

def extract(file, start_pat, end_pat, include_end: true)
  lines = File.readlines(File.join(SRC, file))
  s = lines.index { |l| l.match?(start_pat) } or raise "start not found: #{start_pat} in #{file}"
  e = ((s + 1)...lines.size).find { |i| lines[i].match?(end_pat) } or raise "end not found: #{end_pat}"
  lines[s..(include_end ? e : e - 1)].join
end

# --- Api::ID_REGEX (verbatim constant lines from lib/api.rb)
module Api; end
Api.module_eval(File.readlines("#{SRC}/lib_api.rb").grep(/^\s*(MAX_ID|MAX_ID_LENGTH|ID_REGEX) = /).join)

def parse(body, content_type)
  env = Rack::MockRequest.env_for("/api/v1/probe", method: "POST", input: body, "CONTENT_TYPE" => content_type)
  ActionController::Parameters.new(ActionDispatch::Request.new(env).request_parameters)
end

Criterion = Struct.new(:id, :points, :ignore_for_scoring, :learning_outcome_id, :mastery_points,
                       :criterion_use_range, :ratings, keyword_init: true)
Rating = Struct.new(:id, :points, :description, keyword_init: true)
def ratings3(max)
  [Rating.new(id: "r_full", points: max, description: "Full"),
   Rating.new(id: "r_part", points: max / 2.0, description: "Partial"),
   Rating.new(id: "r_none", points: 0.0, description: "None")]
end
CRITERIA = [
  Criterion.new(id: "_1001", points: 5.0, ratings: ratings3(5.0)),
  Criterion.new(id: "_1002", points: 5.0, ratings: ratings3(5.0)),
  Criterion.new(id: "_1003", points: 2.0, ignore_for_scoring: true, ratings: ratings3(2.0)),
].freeze

# --- RubricAssessmentsController#resolve_user_id (verbatim) + the guard line from #update
class CtrlHarness
  attr_reader :params

  def initialize(params)
    @params = params
  end
  class_eval(extract("rubric_assessments_controller.rb", /^  def resolve_user_id$/, /^  end$/))

  def step
    user_id = resolve_user_id
    # verbatim from #update: raise ActiveRecord::RecordNotFound if user_id.blank?
    return "user_id blank -> raise ActiveRecord::RecordNotFound (Canvas API renders 404)" if user_id.blank?

    "user_id resolved to #{user_id.inspect}; assessment_type=#{params.dig(:rubric_assessment, :assessment_type).inspect}"
  rescue => e
    "#{e.class}: #{e.message} (unrescued in controller -> 500)"
  end
end

# --- RubricAssociation#assess criteria loop + #assessment_points (verbatim)
class AssessHarness
  Ctx = Struct.new(:x) do
    def feature_enabled?(_flag) = false
  end
  attr_accessor :summary_data, :skip_updating_points_possible

  def initialize(criteria)
    @criteria = criteria
  end

  def rubric = Struct.new(:criteria_object).new(@criteria)
  def context = Ctx.new
  def hide_points = false
  def save = true
  def t(_key, default) = default
  class_eval(extract("rubric_association.rb", /^  def assessment_points/, /^  end$/))
  LOOP = extract("rubric_association.rb", /^    ratings = \[\]$/, /^    assessment_to_return = nil$/, include_end: false)
  class_eval(<<~RUBY)
    def run(params, opts = {})
      association = self
      #{LOOP}
      { replace_ratings: replace_ratings, score: score,
        stored_criteria: ratings.map { |r| r.slice(:criterion_id, :points, :ignore_for_scoring, :comments) } }
    end
  RUBY
end

# --- SubmissionsApiController#update rubric_assessment block (verbatim)
class SubmissionsApiHarness
  attr_reader :params

  def initialize(params, criteria, active: true)
    @params = params
    crit = criteria
    assoc = Object.new
    assoc.define_singleton_method(:rubric) { Struct.new(:criteria_object).new(crit) }
    assoc.define_singleton_method(:assess) do |assessor:, user:, artifact:, assessment:|
      AssessHarness.new(crit).run(assessment)
    end
    @assignment = Object.new
    @assignment.define_singleton_method(:active_rubric_association?) { active }
    @assignment.define_singleton_method(:rubric_association) { assoc }
    @current_user = :teacher
    @user = :student
    @submission = :submission
  end

  def render(**kw) = { rendered: kw }
  BLOCK = extract("submissions_api_controller.rb", /^      assessment = params\[:rubric_assessment\]$/,
                  /^      comment = params\[:comment\]$/, include_end: false)
  class_eval(<<~RUBY)
    def run
      #{BLOCK}
      @rubric_assessment || "rubric_assessment NOT processed (no error raised)"
    end
  RUBY
end

# --- RubricAssessment#update_artifact (verbatim), collaborators stubbed
class ArtifactHarness
  attr_reader :calls, :rubric_association, :artifact, :score

  def initialize(use_for_grading:, grade_right:, checkpoints_parent:, artifact_score:, score:)
    @calls = []
    calls = @calls
    assignment = Object.new
    assignment.define_singleton_method(:grants_right?) { |_user, _right| grade_right }
    assignment.define_singleton_method(:checkpoints_parent?) { checkpoints_parent }
    assignment.define_singleton_method(:grade_student) { |_student, **kw| calls << { score: kw[:score] } }
    assoc_class = Struct.new(:use_for_grading, :association_object) do
      def use_for_grading? = use_for_grading
    end
    @rubric_association = assoc_class.new(use_for_grading, assignment)
    art_class = Struct.new(:score, :student, :grade_posting_in_progress) do
      def reload = self
      def blank? = false
    end
    @artifact = art_class.new(artifact_score, :student, false)
    @score = score
  end

  def artifact_type = "Submission"
  def assessor = :assessor
  class_eval(extract("model_rubric_assessment.rb", /^  def update_artifact$/, /^  end$/))
end

# ============================ cases ============================
wire = JSON.parse(File.read(File.join(WORK, "wire.json")))
call = wire.fetch("calls").fetch(0)
shipped_ct = (call["headers"] || {})["Content-Type"]
shipped = parse(call.fetch("body"), shipped_ct)
log("A1 shipped tool body (captured from our client) -> RubricAssessmentsController", {
  content_type: shipped_ct, url: call["url"], body: call["body"], controller: CtrlHarness.new(shipped).step
})
log("A2 shipped body, if it got past user_id -> assess loop", AssessHarness.new(CRITERIA).run(shipped[:rubric_assessment]))

naive_int = parse(JSON.generate(rubric_assessment: { user_id: 42, assessment_type: "grading",
                                                     criterion__1001: { points: 4 } }), "application/json")
log("B1 in-place fix, JSON with numeric user_id", CtrlHarness.new(naive_int).step)
naive_str = parse(JSON.generate(rubric_assessment: { user_id: "42", assessment_type: "grading",
                                                     criterion__1001: { points: 4 } }), "application/json")
log("B2 in-place fix, JSON with string user_id", CtrlHarness.new(naive_str).step)
form = parse("rubric_assessment[user_id]=42&rubric_assessment[assessment_type]=grading" \
             "&rubric_assessment[criterion__1001][points]=4&rubric_assessment[criterion__1002][points]=5" \
             "&rubric_assessment[criterion__1003][points]=2", "application/x-www-form-urlencoded")
log("C1 documented form body -> controller", CtrlHarness.new(form).step)
log("C2 documented form body -> assess loop", AssessHarness.new(CRITERIA).run(form[:rubric_assessment]))

def sub_api(label, hash, active: true)
  params = parse(JSON.generate(hash), "application/json")
  log(label, SubmissionsApiHarness.new(params, CRITERIA, active: active).run)
end
full = { rubric_assessment: { "_1001" => { points: 4, comments: "Good" }, "_1002" => { points: 5 },
                              "_1003" => { points: 2, comments: "n/a" } } }
sub_api("D  submissions API, all criteria (one ignore_for_scoring)", full)
sub_api("E  submissions API, partial criteria (_1001 only)", { rubric_assessment: { "_1001" => { points: 4 } } })
sub_api("F  submissions API, comments only", { rubric_assessment: { "_1001" => { comments: "see me" } } })
sub_api("F2 submissions API, explicit null points on every criterion",
        { rubric_assessment: { "_1001" => { points: nil }, "_1002" => { points: nil }, "_1003" => { points: nil } } })
sub_api("G1 submissions API, unknown criterion id only", { rubric_assessment: { "bogus" => { points: 5 } } })
sub_api("G2 submissions API, known + unknown criterion id",
        { rubric_assessment: { "_1001" => { points: 4 }, "bogus" => { points: 5 } } })
sub_api("H  submissions API, zero points", { rubric_assessment: { "_1001" => { points: 0 }, "_1002" => { points: 0 } } })
sub_api("I  submissions API, assignment has no active rubric association", full, active: false)

matrix = []
[true, false].each do |ufg|
  [true, false].each do |right|
    [false, true].each do |cp|
      [[80.0, 9.0, "differs"], [9.0, 9.0, "already equal"], [80.0, nil, "rubric score nil"]].each do |art, sc, label|
        h = ArtifactHarness.new(use_for_grading: ufg, grade_right: right, checkpoints_parent: cp, artifact_score: art, score: sc)
        h.send(:update_artifact)
        matrix << { use_for_grading: ufg, assessor_has_grade_right: right, checkpoints_parent: cp,
                    submission_score_before: art, rubric_score: sc, case: label,
                    grade_student_called_with: h.calls.first }
      end
    end
  end
end
log("J  update_artifact decision matrix", matrix)

File.write(File.join(WORK, "ruby-probe.json"), JSON.pretty_generate(RESULTS))
RESULTS.each do |r|
  puts "== #{r[:case]}"
  if r[:result].is_a?(Array)
    r[:result].each { |row| puts "   #{row.to_json}" }
  else
    puts "   #{r[:result].to_json}"
  end
end
