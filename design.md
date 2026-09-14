MarkingAssignment
    This is just a holding entry that all the rest hang off.

MarkingRubric
    This links all of the sections in the rubric together, and stores the version.

MarkingSection
    Each bit that can be marked has a section, linked to the rubric.
    They have a weight and ordering.

MarkingSectionResponse
    These give a score (out of 100) that is selected for a section.
    It includes a description to give the requirements they should attain to get.

MarkingGrading
    This links the complete grade for a marker to everything else.
    E.g. it links the assignment, rubric, marker, and student together.

MarkingGradingEntry
    This is a link between the grading, the section and the response.
    There's an attached comment here as well.
    In the new linear marking version this is where the selected value will go.
    In the existing system it just uses the value stored in the linked MarkingSectionResponse

MarkingCombinedGrading
    This gives a name to the combined marksheet with the two headings that go in
    the output PDF.

MarkingCombinedComponent
    This links an assignment to a combined grading.

MarkingCombinedResult
    This stores the final, user entered, marks for the combined result.
    There is one mark for each MarkingCombinedComponent.
    It links a MarkingCombinedGrading to a MarkingStudent.